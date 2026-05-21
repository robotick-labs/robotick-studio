import { useEffect, useRef } from "react";

type StickTopic = "left_stick" | "right_stick";
type StickName = "left" | "right";

interface Vector2 {
  x: number;
  y: number;
}

interface StickController {
  area: HTMLDivElement;
  knob: HTMLDivElement;
  movePointer: (
    globalX: number,
    globalY: number,
    source?: RemoteControlInputSource
  ) => void;
  resetKnob: () => void;
  movePointerToCenter: (force?: boolean) => void;
}

export type RemoteControlState = {
  left: Vector2;
  right: Vector2;
  left_trigger: number;
  right_trigger: number;
  a: boolean;
  b: boolean;
  x: boolean;
  y: boolean;
  left_bumper: boolean;
  right_bumper: boolean;
  back: boolean;
  start: boolean;
  guide: boolean;
  left_stick_button: boolean;
  right_stick_button: boolean;
  dpad_up: boolean;
  dpad_down: boolean;
  dpad_left: boolean;
  dpad_right: boolean;
};

export type RemoteControlStateKey = keyof RemoteControlState;
export type RemoteControlInputSource = "pointer" | "gamepad" | "programmatic";
export type RemoteControlStateKeysMeta = {
  inputSources: Partial<Record<RemoteControlStateKey, RemoteControlInputSource>>;
};
type RemoteControlButtonStateKey = Exclude<
  RemoteControlStateKey,
  "left" | "right" | "left_trigger" | "right_trigger"
>;
type RemoteControlTriggerStateKey = "left_trigger" | "right_trigger";
export type RemoteControlStateKeysCallback = (
  state: RemoteControlState,
  keys: ReadonlyArray<RemoteControlStateKey>,
  meta: RemoteControlStateKeysMeta
) => void;

const REMOTE_CONTROL_STATE_KEYS: RemoteControlStateKey[] = [
  "left",
  "right",
  "left_trigger",
  "right_trigger",
  "a",
  "b",
  "x",
  "y",
  "left_bumper",
  "right_bumper",
  "back",
  "start",
  "guide",
  "left_stick_button",
  "right_stick_button",
  "dpad_up",
  "dpad_down",
  "dpad_left",
  "dpad_right",
];

type UseRemoteControlClientOptions = {
  leftArea: HTMLDivElement | null;
  leftKnob: HTMLDivElement | null;
  rightArea: HTMLDivElement | null;
  rightKnob: HTMLDivElement | null;
  onStateKeys?: RemoteControlStateKeysCallback | null;
  enabled?: boolean;
};

function cloneState(state: RemoteControlState): RemoteControlState {
  return JSON.parse(JSON.stringify(state));
}

function createNeutralState(): RemoteControlState {
  return {
    left: { x: 0.0, y: 0.0 },
    right: { x: 0.0, y: 0.0 },
    left_trigger: 0.0,
    right_trigger: 0.0,
    a: false,
    b: false,
    x: false,
    y: false,
    left_bumper: false,
    right_bumper: false,
    back: false,
    start: false,
    guide: false,
    left_stick_button: false,
    right_stick_button: false,
    dpad_up: false,
    dpad_down: false,
    dpad_left: false,
    dpad_right: false,
  };
}

function buildProgrammaticInputSources(): RemoteControlStateKeysMeta["inputSources"] {
  return Object.fromEntries(
    REMOTE_CONTROL_STATE_KEYS.map((key) => [key, "programmatic"])
  ) as RemoteControlStateKeysMeta["inputSources"];
}

class RemoteControlClient {
  private static readonly GAMEPAD_RESCAN_INTERVAL_MS = 1000;
  private leftStick: StickController;
  private rightStick: StickController;
  private joystickState: RemoteControlState;
  private onStateKeys: RemoteControlStateKeysCallback | null;
  private controlsEnabled = false;
  private readonly localState = {
    left: { x: 0.0, y: 0.0 },
    right: { x: 0.0, y: 0.0 },
  };
  private allowReadGamePad = true;
  private dirtyKeys = new Set<RemoteControlStateKey>();
  private dirtySources = new Map<RemoteControlStateKey, RemoteControlInputSource>();
  private ticking = false;
  private tickTimeout: number | null = null;
  private rafId: number | null = null;
  private disposed = false;
  private lastSentState: RemoteControlState;
  private cleanup: Array<() => void> = [];

  constructor(options: {
    leftArea: HTMLDivElement;
    leftKnob: HTMLDivElement;
    rightArea: HTMLDivElement;
    rightKnob: HTMLDivElement;
    onStateKeys: RemoteControlStateKeysCallback | null;
    enabled: boolean;
  }) {
    this.onStateKeys = options.onStateKeys;
    this.controlsEnabled = Boolean(options.enabled && this.onStateKeys);
    this.joystickState = createNeutralState();
    this.lastSentState = cloneState(this.joystickState);

    this.leftStick = this.createStick(
      options.leftArea,
      options.leftKnob,
      "left_stick",
      true
    );
    this.rightStick = this.createStick(
      options.rightArea,
      options.rightKnob,
      "right_stick",
      true
    );

    this.setupPointerEvents();
    this.setupGamepadPolling();
    this.sendFullState();
  }

  dispose() {
    this.disposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.tickTimeout !== null) {
      clearTimeout(this.tickTimeout);
      this.tickTimeout = null;
    }
    for (const fn of this.cleanup) fn();
    this.cleanup = [];
  }

  setEmitter(onStateKeys: RemoteControlStateKeysCallback | null, enabled: boolean) {
    const nextControlsEnabled = Boolean(enabled && onStateKeys);
    if (!nextControlsEnabled) {
      const finalEmitter = onStateKeys ?? this.onStateKeys;
      this.leftStick.movePointerToCenter(true);
      this.rightStick.movePointerToCenter(true);
      this.joystickState = createNeutralState();
      this.lastSentState = cloneState(this.joystickState);
      this.dirtyKeys.clear();
      this.dirtySources.clear();
      if (finalEmitter) {
        finalEmitter(this.lastSentState, REMOTE_CONTROL_STATE_KEYS, {
          inputSources: buildProgrammaticInputSources(),
        });
      }
      this.onStateKeys = onStateKeys;
      this.controlsEnabled = false;
      this.stopTickLoop();
      return;
    }

    this.onStateKeys = onStateKeys;
    this.controlsEnabled = true;
    this.sendFullState();
  }

  private setupPointerEvents() {
    const activePointers = new Map<
      number,
      { side: StickName; startX: number; startY: number }
    >();

    const getStick = (side: StickName) =>
      side === "left" ? this.leftStick : this.rightStick;

    const resetStick = (side: StickName) => {
      const stick = getStick(side);
      if (this.controlsEnabled) {
        stick.resetKnob();
      } else {
        stick.movePointerToCenter(true);
      }
    };

    const clearPointer = (pointerId: number) => {
      const data = activePointers.get(pointerId);
      if (!data) return;
      resetStick(data.side);
      activePointers.delete(pointerId);
      if (activePointers.size === 0) {
        this.allowReadGamePad = true;
      }
    };

    const cancelAllPointers = () => {
      for (const pointerId of Array.from(activePointers.keys())) {
        clearPointer(pointerId);
      }
      this.allowReadGamePad = true;
    };

    const bindStickEvents = (side: StickName, area: HTMLDivElement) => {
      const onPointerDown = (e: PointerEvent) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        this.allowReadGamePad = false;
        if (!this.controlsEnabled) return;
        activePointers.set(e.pointerId, {
          side,
          startX: e.clientX,
          startY: e.clientY,
        });
        area.setPointerCapture?.(e.pointerId);
        e.preventDefault();
      };

      const onPointerMove = (e: PointerEvent) => {
        const data = activePointers.get(e.pointerId);
        if (!data || !this.controlsEnabled) return;
        const stick = getStick(data.side);
        const dx = e.clientX - data.startX;
        const dy = e.clientY - data.startY;
        const rect = stick.area.getBoundingClientRect();
        const centerX = rect.left + stick.area.clientWidth / 2;
        const centerY = rect.top + stick.area.clientHeight / 2;
        stick.movePointer(centerX + dx, centerY + dy, "pointer");
        e.preventDefault();
      };

      const onPointerEnd = (e: PointerEvent) => {
        if (!activePointers.has(e.pointerId)) return;
        clearPointer(e.pointerId);
        if (area.hasPointerCapture?.(e.pointerId)) {
          area.releasePointerCapture?.(e.pointerId);
        }
      };

      area.addEventListener("pointerdown", onPointerDown);
      area.addEventListener("pointermove", onPointerMove);
      area.addEventListener("pointerup", onPointerEnd);
      area.addEventListener("pointercancel", onPointerEnd);
      area.addEventListener("lostpointercapture", onPointerEnd);

      this.cleanup.push(() =>
        area.removeEventListener("pointerdown", onPointerDown)
      );
      this.cleanup.push(() =>
        area.removeEventListener("pointermove", onPointerMove)
      );
      this.cleanup.push(() =>
        area.removeEventListener("pointerup", onPointerEnd)
      );
      this.cleanup.push(() =>
        area.removeEventListener("pointercancel", onPointerEnd)
      );
      this.cleanup.push(() =>
        area.removeEventListener("lostpointercapture", onPointerEnd)
      );
    };

    bindStickEvents("left", this.leftStick.area);
    bindStickEvents("right", this.rightStick.area);

    const onWindowBlur = () => {
      cancelAllPointers();
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        cancelAllPointers();
      }
    };

    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);

    this.cleanup.push(() => window.removeEventListener("blur", onWindowBlur));
    this.cleanup.push(() =>
      document.removeEventListener("visibilitychange", onVisibilityChange)
    );
  }

  private setupGamepadPolling() {
    let activeGamepadIndex: number | null = null;
    const isUsableGamepad = (gamepad: Gamepad | null | undefined) => {
      if (!gamepad) return false;
      if (gamepad.connected) return true;
      if (gamepad.mapping === "standard") return true;
      if ((gamepad.axes?.length ?? 0) > 0) return true;
      if ((gamepad.buttons?.length ?? 0) > 0) return true;
      return false;
    };

    const findConnectedGamepadIndex = () => {
      const pads = navigator.getGamepads();
      for (let i = 0; i < pads.length; i += 1) {
        if (isUsableGamepad(pads[i])) return i;
      }
      return null;
    };

    const startPollingIfNeeded = (index: number) => {
      if (activeGamepadIndex === index && this.rafId !== null) {
        return;
      }
      activeGamepadIndex = index;
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      this.pollGamepad(index);
    };

    const onConnected = (e: GamepadEvent) => {
      startPollingIfNeeded(e.gamepad.index);
    };

    const onDisconnected = (e: GamepadEvent) => {
      if (activeGamepadIndex !== null && e.gamepad.index !== activeGamepadIndex) {
        return;
      }

      const fallbackIndex = findConnectedGamepadIndex();
      activeGamepadIndex = fallbackIndex;
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      if (fallbackIndex !== null) {
        startPollingIfNeeded(fallbackIndex);
      }
    };

    window.addEventListener("gamepadconnected", onConnected);
    window.addEventListener("gamepaddisconnected", onDisconnected);

    this.cleanup.push(() =>
      window.removeEventListener("gamepadconnected", onConnected)
    );
    this.cleanup.push(() =>
      window.removeEventListener("gamepaddisconnected", onDisconnected)
    );

    const scanIntervalId = window.setInterval(() => {
      if (this.disposed || this.rafId !== null) {
        return;
      }
      const fallbackIndex = findConnectedGamepadIndex();
      if (fallbackIndex !== null) {
        startPollingIfNeeded(fallbackIndex);
      }
    }, RemoteControlClient.GAMEPAD_RESCAN_INTERVAL_MS);
    this.cleanup.push(() => window.clearInterval(scanIntervalId));

    const initialIndex = findConnectedGamepadIndex();
    if (initialIndex !== null) {
      startPollingIfNeeded(initialIndex);
    }
  }

  private pollGamepad(index: number) {
    let currentIndex = index;
    let lxLast = 0;
    let lyLast = 0;
    let rxLast = 0;
    let ryLast = 0;
    let lastButtons = "";

    const findConnectedGamepadIndex = () => {
      const pads = navigator.getGamepads();
      for (let i = 0; i < pads.length; i += 1) {
        if (pads[i] && (pads[i].connected || pads[i].mapping === "standard")) {
          return i;
        }
      }
      return null;
    };

    const loop = () => {
      if (this.disposed) return;
      const pads = navigator.getGamepads();
      const gp = pads[currentIndex];
      if (!gp) {
        const fallbackIndex = findConnectedGamepadIndex();
        if (fallbackIndex !== null) {
          currentIndex = fallbackIndex;
        }
        this.allowReadGamePad = true;
        this.rafId = requestAnimationFrame(loop);
        return;
      }

      if (!this.allowReadGamePad) {
        this.rafId = requestAnimationFrame(loop);
        return;
      }
      if (!this.controlsEnabled) {
        this.rafId = requestAnimationFrame(loop);
        return;
      }

      let lx = gp.axes[0] || 0;
      let ly = -(gp.axes[1] || 0);
      let rx = gp.axes[2] || 0;
      let ry = -(gp.axes[3] || 0);

      const lt = gp.buttons[6]?.value || 0;
      const rt = gp.buttons[7]?.value || 0;

      const buttonMap: Array<[RemoteControlButtonStateKey, number]> = [
        ["a", 0],
        ["b", 1],
        ["x", 2],
        ["y", 3],
        ["left_bumper", 4],
        ["right_bumper", 5],
        ["back", 8],
        ["start", 9],
        ["left_stick_button", 10],
        ["right_stick_button", 11],
        ["dpad_up", 12],
        ["dpad_down", 13],
        ["dpad_left", 14],
        ["dpad_right", 15],
        ["guide", 16],
      ];

      let currentButtons = "";
      for (const [, idx] of buttonMap) {
        currentButtons += gp.buttons[idx]?.pressed ? "1" : "0";
      }

      const axesChanged =
        lx !== lxLast || ly !== lyLast || rx !== rxLast || ry !== ryLast;
      const triggersChanged =
        this.joystickState.left_trigger !== lt ||
        this.joystickState.right_trigger !== rt;
      const buttonsChanged = currentButtons !== lastButtons;

      if (axesChanged || triggersChanged || buttonsChanged) {
        lxLast = lx;
        lyLast = ly;
        rxLast = rx;
        ryLast = ry;
        lastButtons = currentButtons;

        this.sendJoystickInput("left_stick", lx, ly, "gamepad");
        this.sendJoystickInput("right_stick", rx, ry, "gamepad");
        this.updateTrigger("left_trigger", lt, "gamepad");
        this.updateTrigger("right_trigger", rt, "gamepad");

        for (const [name, idx] of buttonMap) {
          const pressed = !!gp.buttons[idx]?.pressed;
          if (this.joystickState[name] !== pressed) {
            this.joystickState[name] = pressed;
            this.markDirty(name, "gamepad");
          }
        }

        this.moveStickVisual(this.leftStick, lx, ly);
        this.moveStickVisual(this.rightStick, rx, ry);
        if (!this.ticking) this.startTickLoop();
      }

      this.rafId = requestAnimationFrame(loop);
    };

    this.rafId = requestAnimationFrame(loop);
  }

  private markDirty(
    key: RemoteControlStateKey,
    source: RemoteControlInputSource
  ) {
    this.dirtyKeys.add(key);
    this.dirtySources.set(key, source);
  }

  private sendJoystickInput(
    topic: StickTopic,
    x: number,
    y: number,
    source: RemoteControlInputSource = "programmatic"
  ) {
    if (!this.controlsEnabled) return;
    const clampedX = Math.max(-1, Math.min(1, x));
    const clampedY = Math.max(-1, Math.min(1, y));
    const key = topic === "left_stick" ? "left" : "right";

    if (topic === "left_stick") {
      this.joystickState.left = { x: clampedX, y: clampedY };
    } else {
      this.joystickState.right = { x: clampedX, y: clampedY };
    }

    this.markDirty(key, source);
  }

  private updateTrigger(
    key: RemoteControlTriggerStateKey,
    value: number,
    source: RemoteControlInputSource = "programmatic"
  ) {
    if (!this.controlsEnabled) return;
    const clamped = Math.max(0, Math.min(1, value));
    if (this.joystickState[key] !== clamped) {
      this.joystickState[key] = clamped;
      this.markDirty(key, source);
    }
  }

  private moveStickVisual(
    stick: StickController,
    x: number,
    y: number,
    force = false
  ) {
    if (!this.controlsEnabled && !force) return;
    const radius = stick.area.clientWidth / 2;
    stick.knob.style.transform = `translate(-50%, -50%) translate(${
      x * radius
    }px, ${-y * radius}px)`;
  }

  private moveStickState(stick: StickController, x: number, y: number) {
    if (!this.controlsEnabled) return;
    const rect = stick.area.getBoundingClientRect();
    const centerX = rect.left + stick.area.clientWidth / 2;
    const centerY = rect.top + stick.area.clientHeight / 2;
    stick.movePointer(centerX + x, centerY + y);
  }

  private createStick(
    area: HTMLDivElement,
    knob: HTMLDivElement,
    topic: StickTopic,
    updateLocalState: boolean
  ): StickController {
    const radius = area.clientWidth / 2;
    const movePointer = (
      globalX: number,
      globalY: number,
      source: RemoteControlInputSource = "pointer"
    ) => {
      const rect = area.getBoundingClientRect();
      const dx = globalX - (rect.left + radius);
      const dy = globalY - (rect.top + radius);
      const normX = Math.max(-1, Math.min(1, dx / radius));
      const normY = Math.max(-1, Math.min(1, -(dy / radius)));

      knob.style.transform = `translate(-50%, -50%) translate(${
        normX * radius
      }px, ${-normY * radius}px)`;

      this.sendJoystickInput(topic, normX, normY, source);
      if (!this.ticking) this.startTickLoop();

      if (updateLocalState) {
        const local =
          this.localState[topic === "left_stick" ? "left" : "right"];
        local.x = normX;
        local.y = normY;
      }
    };

    const resetKnob = () => {
      if (!this.controlsEnabled) return;
      knob.style.transform = `translate(-50%, -50%)`;
      this.sendJoystickInput(topic, 0, 0, "pointer");
      if (!this.ticking) this.startTickLoop();
      if (updateLocalState) {
        const local =
          this.localState[topic === "left_stick" ? "left" : "right"];
        local.x = 0;
        local.y = 0;
      }
    };

    const controller: StickController = {
      area,
      knob,
      movePointer,
      resetKnob,
      movePointerToCenter: () => {},
    };
    controller.movePointerToCenter = (force = false) => {
      if (!this.controlsEnabled && !force) return;
      this.moveStickVisual(controller, 0, 0, force);
      const stateKey = topic === "left_stick" ? "left" : "right";
      this.joystickState[stateKey] = { x: 0, y: 0 };
      if (this.controlsEnabled) {
        this.markDirty(stateKey, "programmatic");
        if (!this.ticking) this.startTickLoop();
      }
      if (updateLocalState) {
        const local = this.localState[stateKey];
        local.x = 0;
        local.y = 0;
      }
    };

    return controller;
  }

  private startTickLoop() {
    if (!this.controlsEnabled) return;
    this.ticking = true;
    const tick = () => {
      if (!this.ticking) return;
      this.sendDirtyKeys();
      this.tickTimeout = window.setTimeout(tick, 50);
    };
    tick();
  }

  private stopTickLoop() {
    this.ticking = false;
    if (this.tickTimeout !== null) {
      clearTimeout(this.tickTimeout);
      this.tickTimeout = null;
    }
  }

  private sendStateKeys(
    state: RemoteControlState,
    keys: ReadonlyArray<RemoteControlStateKey>,
    meta: RemoteControlStateKeysMeta
  ) {
    if (!this.controlsEnabled || !this.onStateKeys || keys.length === 0) {
      return;
    }
    this.onStateKeys(state, keys, meta);
  }

  private sendDirtyKeys() {
    if (this.dirtyKeys.size === 0) return;
    const nextState = cloneState(this.joystickState);
    this.lastSentState = nextState;
    const dirtyKeys = Array.from(this.dirtyKeys);
    const inputSources = Object.fromEntries(
      dirtyKeys.map((key) => [
        key,
        this.dirtySources.get(key) ?? "programmatic",
      ])
    ) as RemoteControlStateKeysMeta["inputSources"];
    this.dirtyKeys.clear();
    this.dirtySources.clear();
    this.sendStateKeys(nextState, dirtyKeys, { inputSources });
  }

  private sendFullState() {
    const nextState = cloneState(this.joystickState);
    this.lastSentState = nextState;
    this.sendStateKeys(nextState, REMOTE_CONTROL_STATE_KEYS, {
      inputSources: buildProgrammaticInputSources(),
    });
  }

  syncNow() {
    this.sendFullState();
  }
}

export function useRemoteControlClient({
  leftArea,
  leftKnob,
  rightArea,
  rightKnob,
  onStateKeys,
  enabled = true,
}: UseRemoteControlClientOptions) {
  const clientRef = useRef<RemoteControlClient | null>(null);

  useEffect(() => {
    if (!leftArea || !leftKnob || !rightArea || !rightKnob) {
      return;
    }

    const client = new RemoteControlClient({
      leftArea,
      leftKnob,
      rightArea,
      rightKnob,
      onStateKeys: null,
      enabled: false,
    });
    clientRef.current = client;

    return () => {
      client.dispose();
      clientRef.current = null;
    };
  }, [
    leftArea,
    leftKnob,
    rightArea,
    rightKnob,
  ]);

  useEffect(() => {
    if (clientRef.current) {
      clientRef.current.setEmitter(onStateKeys ?? null, enabled);
    }
  }, [enabled, onStateKeys]);
}
