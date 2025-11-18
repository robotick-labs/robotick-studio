import { REMOTE_CONTROL_BASE } from "../../../core/config";

type StickTopic = "left_stick" | "right_stick";
type StickName = "left" | "right";

interface Vector2 {
  x: number;
  y: number;
}

interface StickController {
  area: HTMLDivElement;
  knob: HTMLDivElement;
  movePointer: (globalX: number, globalY: number) => void;
  resetKnob: () => void;
  movePointerToCenter: () => void;
}

export interface RemoteControlOptions {
  leftArea: HTMLDivElement;
  leftKnob: HTMLDivElement;
  rightArea: HTMLDivElement;
  rightKnob: HTMLDivElement;
}

const remoteControlServer = REMOTE_CONTROL_BASE;

type JoystickState = {
  use_web_inputs: boolean;
  left: Vector2;
  right: Vector2;
  left_trigger: number;
  right_trigger: number;
  dead_zone_left: Vector2;
  dead_zone_right: Vector2;
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

function cloneState(state: JoystickState): JoystickState {
  return JSON.parse(JSON.stringify(state));
}

export class RemoteControlClient {
  private leftStick: StickController;
  private rightStick: StickController;
  private joystickState: JoystickState;
  private readonly localState = {
    left: { x: 0.0, y: 0.0 },
    right: { x: 0.0, y: 0.0 },
  };
  private allowReadGamePad = true;
  private dirtyKeys = new Set<keyof JoystickState>();
  private ticking = false;
  private tickTimeout: number | null = null;
  private rafId: number | null = null;
  private disposed = false;
  private lastSentState: JoystickState;
  private cleanup: Array<() => void> = [];

  constructor(options: RemoteControlOptions) {
    this.joystickState = {
      use_web_inputs: true,
      left: { x: 0.0, y: 0.0 },
      right: { x: 0.0, y: 0.0 },
      left_trigger: 0.0,
      right_trigger: 0.0,
      dead_zone_left: { x: 0.1, y: 0.1 },
      dead_zone_right: { x: 0.1, y: 0.1 },
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
      true,
      true
    );
    this.rightStick = this.createStick(
      options.rightArea,
      options.rightKnob,
      "right_stick",
      true,
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

  setUseWebInputs(enabled: boolean) {
    this.joystickState.use_web_inputs = enabled;
    this.dirtyKeys.add("use_web_inputs");
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
      for (const touch of Array.from(e.changedTouches)) {
        const data = activeTouches[touch.identifier];
        if (!data) continue;
        const dx = touch.clientX - data.startX;
        const dy = touch.clientY - data.startY;
        const stick = data.side === "left" ? this.leftStick : this.rightStick;
        const rect = stick.area.getBoundingClientRect();
        const centerX = rect.left + stick.area.clientWidth / 2;
        const centerY = rect.top + stick.area.clientHeight / 2;
        stick.movePointer(centerX + dx, centerY + dy);
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      this.allowReadGamePad = true;
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
      if (this.leftStick.area.contains(e.target as Node)) {
        mouseActive = "left";
        mouseStartX = e.clientX;
        mouseStartY = e.clientY;
        this.leftStick.movePointerToCenter();
      } else if (this.rightStick.area.contains(e.target as Node)) {
        mouseActive = "right";
        mouseStartX = e.clientX;
        mouseStartY = e.clientY;
        this.rightStick.movePointerToCenter();
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!mouseActive) return;
      const dx = e.clientX - mouseStartX;
      const dy = e.clientY - mouseStartY;
      const stick = mouseActive === "left" ? this.leftStick : this.rightStick;
      const rect = stick.area.getBoundingClientRect();
      const centerX = rect.left + stick.area.clientWidth / 2;
      const centerY = rect.top + stick.area.clientHeight / 2;
      stick.movePointer(centerX + dx, centerY + dy);
    };

    const onMouseUp = () => {
      this.allowReadGamePad = true;
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
    this.cleanup.push(() =>
      document.removeEventListener("mouseup", onMouseUp)
    );
  }

  private setupGamepadPolling() {
    let activeGamepadIndex: number | null = null;

    const onConnected = (e: GamepadEvent) => {
      activeGamepadIndex = e.gamepad.index;
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      this.pollGamepad(activeGamepadIndex!);
    };

    const onDisconnected = () => {
      activeGamepadIndex = null;
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
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
  }

  private pollGamepad(index: number) {
    let lxLast = 0;
    let lyLast = 0;
    let rxLast = 0;
    let ryLast = 0;
    let lastButtons = "";

    const loop = () => {
      if (this.disposed) return;
      const pads = navigator.getGamepads();
      const gp = pads[index];
      if (!gp) {
        this.allowReadGamePad = true;
        this.rafId = requestAnimationFrame(loop);
        return;
      }

      if (!this.allowReadGamePad) {
        this.rafId = requestAnimationFrame(loop);
        return;
      }

      let lx = gp.axes[0] || 0;
      let ly = -(gp.axes[1] || 0);
      let rx = gp.axes[2] || 0;
      let ry = -(gp.axes[3] || 0);

      ({ x: lx, y: ly } = this.expandCircularToSquare(lx, ly));
      ({ x: rx, y: ry } = this.expandCircularToSquare(rx, ry));

      const dzLeft = this.joystickState.dead_zone_left;
      const dzRight = this.joystickState.dead_zone_right;

      lx = this.applyDeadZone(lx, dzLeft.x);
      ly = this.applyDeadZone(ly, dzLeft.y);
      rx = this.applyDeadZone(rx, dzRight.x);
      ry = this.applyDeadZone(ry, dzRight.y);

      const lt = gp.buttons[6]?.value || 0;
      const rt = gp.buttons[7]?.value || 0;

      const buttonMap: Array<[keyof JoystickState, number]> = [
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

        this.sendJoystickInput("left_stick", lx, ly);
        this.sendJoystickInput("right_stick", rx, ry);
        this.updateTrigger("left_trigger", lt);
        this.updateTrigger("right_trigger", rt);

        const joystickRecord = this.joystickState as Record<string, unknown>;
        for (const [name, idx] of buttonMap) {
          const pressed = !!gp.buttons[idx]?.pressed;
          if (joystickRecord[name as string] !== pressed) {
            joystickRecord[name as string] = pressed;
            this.dirtyKeys.add(name);
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

  private updateTrigger(
    key: "left_trigger" | "right_trigger",
    value: number
  ) {
    if (Math.abs(this.joystickState[key] - value) > 0.001) {
      this.joystickState[key] = value;
      this.dirtyKeys.add(key);
    }
  }

  private startTickLoop() {
    if (this.ticking) return;
    this.ticking = true;

    const tick = () => {
      if (this.disposed) return;
      if (this.dirtyKeys.size === 0) {
        this.ticking = false;
        this.tickTimeout = null;
        return;
      }

      const payload: Record<string, unknown> = {
        use_web_inputs: this.joystickState.use_web_inputs,
      };

      const joystickRecord = this.joystickState as Record<string, any>;
      const lastRecord = this.lastSentState as Record<string, any>;
      const payloadRecord = payload as Record<string, any>;

      for (const key of Array.from(this.dirtyKeys)) {
        const current = joystickRecord[key as string];
        const last = lastRecord[key as string];

        if (
          typeof current === "object" &&
          current !== null &&
          typeof (current as Vector2).x === "number"
        ) {
          const currentVec = current as Vector2;
          const lastVec = last as Vector2;
          if (
            Math.abs(currentVec.x - lastVec.x) > 0.001 ||
            Math.abs(currentVec.y - lastVec.y) > 0.001
          ) {
            payloadRecord[key as string] = {
              x: currentVec.x,
              y: currentVec.y,
            };
            lastVec.x = currentVec.x;
            lastVec.y = currentVec.y;
          }
        } else if (typeof current === "number") {
          if (Math.abs((current as number) - (last as number)) > 0.001) {
            payloadRecord[key as string] = current;
            lastRecord[key as string] = current;
          }
        } else if (typeof current === "boolean") {
          if (current !== last) {
            payloadRecord[key as string] = current;
            lastRecord[key as string] = current;
          }
        } else {
          payloadRecord[key as string] = current;
          lastRecord[key as string] = current;
        }
      }

      this.dirtyKeys.clear();

      fetch(`${remoteControlServer}/api/joystick_input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch((err) => console.error("POST error:", err));

      this.tickTimeout = window.setTimeout(tick, 33);
    };

    tick();
  }

  private createStick(
    area: HTMLDivElement,
    knob: HTMLDivElement,
    topic: StickTopic,
    autoCenterX: boolean,
    autoCenterY: boolean
  ): StickController {
    const setKnob = (x: number, y: number) => {
      knob.style.left = `${x}px`;
      knob.style.top = `${y}px`;
    };

    const movePointer = (globalX: number, globalY: number) => {
      const rect = area.getBoundingClientRect();
      const originX = rect.width / 2;
      const originY = rect.height / 2;
      let dx = globalX - rect.left - originX;
      let dy = globalY - rect.top - originY;

      const maxRangeX = rect.width / 2 - knob.offsetWidth / 2;
      const maxRangeY = rect.height / 2 - knob.offsetHeight / 2;
      dx = Math.max(-maxRangeX, Math.min(maxRangeX, dx));
      dy = Math.max(-maxRangeY, Math.min(maxRangeY, dy));

      setKnob(originX + dx, originY + dy);

      const normX = dx / maxRangeX;
      const normY = -dy / maxRangeY;
      this.sendJoystickInput(topic, normX, normY);
    };

    const resetKnob = () => {
      const rect = area.getBoundingClientRect();
      const originX = rect.width / 2;
      const originY = rect.height / 2;
      const x = autoCenterX ? originX : knob.offsetLeft;
      const y = autoCenterY ? originY : knob.offsetTop;

      setKnob(x, y);

      const normX = autoCenterX
        ? 0
        : (x - originX) / (rect.width / 2 - knob.offsetWidth / 2);
      const normY = autoCenterY
        ? 0
        : -(y - originY) / (rect.height / 2 - knob.offsetHeight / 2);
      this.sendJoystickInput(topic, normX, normY);
    };

    const movePointerToCenter = () => {
      const rect = area.getBoundingClientRect();
      movePointer(rect.left + rect.width / 2, rect.top + rect.height / 2);
    };

    return { area, knob, movePointer, resetKnob, movePointerToCenter };
  }

  private moveStickVisual(stick: StickController, normX: number, normY: number) {
    const rect = stick.area.getBoundingClientRect();
    const originX = rect.width / 2;
    const originY = rect.height / 2;
    const maxRangeX = rect.width / 2 - stick.knob.offsetWidth / 2;
    const maxRangeY = rect.height / 2 - stick.knob.offsetHeight / 2;

    const dx = normX * maxRangeX;
    const dy = -normY * maxRangeY;

    stick.knob.style.left = `${originX + dx}px`;
    stick.knob.style.top = `${originY + dy}px`;
  }

  private applyDeadZone(value: number, threshold: number) {
    if (Math.abs(value) < threshold) return 0.0;
    const sign = value > 0 ? 1 : -1;
    return ((Math.abs(value) - threshold) / (1.0 - threshold)) * sign;
  }

  private expandCircularToSquare(x: number, y: number) {
    const x2 = x * x;
    const y2 = y * y;
    return {
      x: x / Math.sqrt(1 - y2 / 2),
      y: y / Math.sqrt(1 - x2 / 2),
    };
  }

  private sendJoystickInput(topic: StickTopic, normX: number, normY: number) {
    const mapping: Record<StickTopic, StickName> = {
      left_stick: "left",
      right_stick: "right",
    };

    const key = mapping[topic];
    const dz =
      this.joystickState[key === "left" ? "dead_zone_left" : "dead_zone_right"];
    const filteredX = this.applyDeadZone(normX, dz.x);
    const filteredY = this.applyDeadZone(normY, dz.y);

    this.localState[key].x = filteredX;
    this.localState[key].y = filteredY;

    this.joystickState[key].x = filteredX;
    this.joystickState[key].y = filteredY;
    this.dirtyKeys.add(key);

    if (!this.ticking) this.startTickLoop();
  }

  private sendFullState() {
    fetch(`${remoteControlServer}/api/joystick_input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.joystickState),
    }).catch((err) => console.error("POST error:", err));
  }
}
