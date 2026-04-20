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

class RemoteControlClient {
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
    this.joystickState = {
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

    this.setupTouchEvents();
    this.setupMouseEvents();
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
    this.onStateKeys = onStateKeys;
    this.controlsEnabled = Boolean(enabled && this.onStateKeys);
    if (!this.controlsEnabled) {
      this.leftStick.movePointerToCenter(true);
      this.rightStick.movePointerToCenter(true);
      this.stopTickLoop();
      return;
    }
    this.sendFullState();
  }

  private setupTouchEvents() {
    const activeTouches: Record<
      number,
      { side: StickName; startX: number; startY: number }
    > = {};

    const touchStartedInArea = (touch: Touch, area: HTMLDivElement) => {
      const rect = area.getBoundingClientRect();
      return (
        touch.clientX >= rect.left &&
        touch.clientX <= rect.right &&
        touch.clientY >= rect.top &&
        touch.clientY <= rect.bottom
      );
    };

    const onTouchStart = (e: TouchEvent) => {
      this.allowReadGamePad = false;
      if (!this.controlsEnabled) return;
      for (const touch of Array.from(e.changedTouches)) {
        if (touchStartedInArea(touch, this.leftStick.area)) {
          activeTouches[touch.identifier] = {
            side: "left",
            startX: touch.clientX,
            startY: touch.clientY,
          };
        } else if (touchStartedInArea(touch, this.rightStick.area)) {
          activeTouches[touch.identifier] = {
            side: "right",
            startX: touch.clientX,
            startY: touch.clientY,
          };
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!this.controlsEnabled) return;
      for (const touch of Array.from(e.changedTouches)) {
        const data = activeTouches[touch.identifier];
        if (!data) continue;
        const dx = touch.clientX - data.startX;
        const dy = touch.clientY - data.startY;
        const stick = data.side === "left" ? this.leftStick : this.rightStick;
        const rect = stick.area.getBoundingClientRect();
        const centerX = rect.left + stick.area.clientWidth / 2;
        const centerY = rect.top + stick.area.clientHeight / 2;
        stick.movePointer(centerX + dx, centerY + dy, "pointer");
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      this.allowReadGamePad = true;
      if (!this.controlsEnabled) return;
      for (const touch of Array.from(e.changedTouches)) {
        const data = activeTouches[touch.identifier];
        if (!data) continue;
        const stick = data.side === "left" ? this.leftStick : this.rightStick;
        stick.resetKnob();
        delete activeTouches[touch.identifier];
      }
    };

    document.addEventListener("touchstart", onTouchStart);
    document.addEventListener("touchmove", onTouchMove);
    document.addEventListener("touchend", handleTouchEnd);
    document.addEventListener("touchcancel", handleTouchEnd);

    this.cleanup.push(() =>
      document.removeEventListener("touchstart", onTouchStart)
    );
    this.cleanup.push(() =>
      document.removeEventListener("touchmove", onTouchMove)
    );
    this.cleanup.push(() =>
      document.removeEventListener("touchend", handleTouchEnd)
    );
    this.cleanup.push(() =>
      document.removeEventListener("touchcancel", handleTouchEnd)
    );
  }

  private setupMouseEvents() {
    let mouseActive: StickName | null = null;
    let mouseStartX = 0;
    let mouseStartY = 0;

    const onMouseDown = (e: MouseEvent) => {
      this.allowReadGamePad = false;
      if (!this.controlsEnabled) return;
      if (this.leftStick.area.contains(e.target as Node)) {
        mouseActive = "left";
        mouseStartX = e.clientX;
        mouseStartY = e.clientY;
      } else if (this.rightStick.area.contains(e.target as Node)) {
        mouseActive = "right";
        mouseStartX = e.clientX;
        mouseStartY = e.clientY;
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!mouseActive) return;
      if (!this.controlsEnabled) return;
      const dx = e.clientX - mouseStartX;
      const dy = e.clientY - mouseStartY;
      const stick = mouseActive === "left" ? this.leftStick : this.rightStick;
      const rect = stick.area.getBoundingClientRect();
      const centerX = rect.left + stick.area.clientWidth / 2;
      const centerY = rect.top + stick.area.clientHeight / 2;
      stick.movePointer(centerX + dx, centerY + dy, "pointer");
    };

    const onMouseUp = () => {
      this.allowReadGamePad = true;
      if (!this.controlsEnabled) return;
      if (mouseActive === "left") this.leftStick.resetKnob();
      else if (mouseActive === "right") this.rightStick.resetKnob();
      mouseActive = null;
    };

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    this.cleanup.push(() =>
      document.removeEventListener("mousedown", onMouseDown)
    );
    this.cleanup.push(() =>
      document.removeEventListener("mousemove", onMouseMove)
    );
    this.cleanup.push(() => document.removeEventListener("mouseup", onMouseUp));
  }

  private setupGamepadPolling() {
    let activeGamepadIndex: number | null = null;
    const findConnectedGamepadIndex = () => {
      const pads = navigator.getGamepads();
      for (let i = 0; i < pads.length; i += 1) {
        if (pads[i]?.connected) return i;
      }
      return null;
    };

    const onConnected = (e: GamepadEvent) => {
      activeGamepadIndex = e.gamepad.index;
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      this.pollGamepad(activeGamepadIndex!);
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
        this.pollGamepad(fallbackIndex);
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

    const initialIndex = findConnectedGamepadIndex();
    if (initialIndex !== null) {
      activeGamepadIndex = initialIndex;
      this.pollGamepad(initialIndex);
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
        if (pads[i]?.connected) return i;
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
    const keys: RemoteControlStateKey[] = [
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
    this.sendStateKeys(nextState, keys, {
      inputSources: Object.fromEntries(
        keys.map((key) => [key, "programmatic"])
      ) as RemoteControlStateKeysMeta["inputSources"],
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
      onStateKeys: onStateKeys ?? null,
      enabled,
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
    onStateKeys,
    enabled,
  ]);

  useEffect(() => {
    if (clientRef.current) {
      clientRef.current.setEmitter(onStateKeys ?? null, enabled);
    }
  }, [enabled, onStateKeys]);
}
