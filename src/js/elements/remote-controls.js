// remote_control.js — Full version: preserves original functionality, adds Xbox 360 buttons

const localState = {
  left: { x: 0.0, y: 0.0 },
  right: { x: 0.0, y: 0.0 },
};

const joystickState = {
  use_web_inputs: true,
  left: { x: 0.0, y: 0.0 },
  right: { x: 0.0, y: 0.0 },
  left_trigger: 0.0,
  right_trigger: 0.0,
  dead_zone_left: { x: 0.1, y: 0.1 },
  dead_zone_right: { x: 0.1, y: 0.1 },

  // Added: Xbox 360 button booleans
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

let allowReadGamePad = true;

const remoteControlServer = "http://localhost:7080";

const lastSentState = JSON.parse(JSON.stringify(joystickState));
let dirtyKeys = new Set();
let ticking = false;

function init() {
  console.log("Remote Control page initialized");

  const leftStick = createStick(
    "left-area",
    "left-knob",
    "left_stick",
    true,
    true
  );
  const rightStick = createStick(
    "right-area",
    "right-knob",
    "right_stick",
    true,
    false
  );

  setupTouchEvents(leftStick, rightStick);
  setupMouseEvents(leftStick, rightStick);
  setupUIControls();
  setupGamepadPolling(leftStick, rightStick);
}

function uninit() {
  console.log("Remote Control page uninitializing");

  // cancel tick loop
  ticking = false;

  // Optional: reset joystick state
  localState.left = { x: 0, y: 0 };
  localState.right = { x: 0, y: 0 };
  joystickState.left = { x: 0, y: 0 };
  joystickState.right = { x: 0, y: 0 };
  dirtyKeys.clear();

  // Optional: remove global event listeners if you added any (e.g. for touch/mouse)
  // For now we're relying on page unload clearing those
}

function setupGamepadPolling(leftStick, rightStick) {
  let activeGamepadIndex = null;

  window.addEventListener("gamepadconnected", (e) => {
    console.log("Gamepad connected:", e.gamepad.id);
    activeGamepadIndex = e.gamepad.index;
    requestAnimationFrame(pollGamepad);
  });

  window.addEventListener("gamepaddisconnected", () => {
    console.log("Gamepad disconnected");
    activeGamepadIndex = null;
  });

  function expandCircularToSquare(x, y) {
    const x2 = x * x;
    const y2 = y * y;
    const newX = x / Math.sqrt(1 - y2 / 2);
    const newY = y / Math.sqrt(1 - x2 / 2);
    return { x: newX, y: newY };
  }

  let lx_last_gamepad = 0.0;
  let ly_last_gamepad = 0.0;
  let rx_last_gamepad = 0.0;
  let ry_last_gamepad = 0.0;
  let last_button_snapshot = ""; // simple change detector for buttons

  function pollGamepad() {
    if (activeGamepadIndex === null) return;

    if (!allowReadGamePad) {
      requestAnimationFrame(pollGamepad);
      return;
    }

    const gp = navigator.getGamepads()[activeGamepadIndex];
    if (!gp) return;

    // Get raw gamepad axes
    let lx = gp.axes[0] || 0;
    let ly = -(gp.axes[1] || 0); // Y inverted
    let rx = gp.axes[2] || 0;
    let ry = -(gp.axes[3] || 0); // Y inverted

    // Expand from circle to square
    ({ x: lx, y: ly } = expandCircularToSquare(lx, ly));
    ({ x: rx, y: ry } = expandCircularToSquare(rx, ry));

    const dz_left = joystickState["dead_zone_left"];
    const dz_right = joystickState["dead_zone_right"];

    lx = applyDeadZone(lx, dz_left.x);
    ly = applyDeadZone(ly, dz_left.y);
    rx = applyDeadZone(rx, dz_right.x);
    ry = applyDeadZone(ry, dz_right.y);

    // Read triggers (buttons 6 and 7 values run 0..1)
    const lt = gp.buttons[6]?.value || 0.0;
    const rt = gp.buttons[7]?.value || 0.0;

    // Read buttons
    const buttonMap = [
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

    // Make a compact pressed-state snapshot for cheap equality check
    let button_snapshot = "";
    for (const [name, index] of buttonMap) {
      const pressed = !!gp.buttons[index]?.pressed;
      button_snapshot += pressed ? "1" : "0";
    }

    // If truly nothing moved/changed since last frame, skip work
    const noAxesChange =
      lx_last_gamepad === lx &&
      ly_last_gamepad === ly &&
      rx_last_gamepad === rx &&
      ry_last_gamepad === ry;

    const noTriggerChange =
      joystickState.left_trigger === lt && joystickState.right_trigger === rt;

    const noButtonChange = last_button_snapshot === button_snapshot;

    if (noAxesChange && noTriggerChange && noButtonChange) {
      requestAnimationFrame(pollGamepad);
      return;
    }

    // Update cached comparisons
    lx_last_gamepad = lx;
    ly_last_gamepad = ly;
    rx_last_gamepad = rx;
    ry_last_gamepad = ry;
    last_button_snapshot = button_snapshot;

    // Update triggers
    if (joystickState.left_trigger !== lt) {
      joystickState.left_trigger = lt;
      dirtyKeys.add("left_trigger");
    }
    if (joystickState.right_trigger !== rt) {
      joystickState.right_trigger = rt;
      dirtyKeys.add("right_trigger");
    }

    // Update sticks
    sendJoystickInput("left_stick", lx, ly);
    sendJoystickInput("right_stick", rx, ry);

    // Update buttons -> booleans + mark dirty when changed
    for (const [name, index] of buttonMap) {
      const pressed = !!gp.buttons[index]?.pressed;
      if (joystickState[name] !== pressed) {
        joystickState[name] = pressed;
        dirtyKeys.add(name);
      }
    }

    // Move knobs visually
    moveStickVisual(leftStick, lx, ly);
    moveStickVisual(rightStick, rx, ry);

    if (!ticking) startTickLoop();

    // request next update
    requestAnimationFrame(pollGamepad);
  }
}

function moveStickVisual(stick, normX, normY) {
  const rect = stick.area.getBoundingClientRect();
  const knob =
    stick.area.querySelector(".joystick-knob") ||
    stick.area.querySelector("div");

  const originX = rect.width / 2;
  const originY = rect.height / 2;

  const maxRangeX = rect.width / 2 - knob.offsetWidth / 2;
  const maxRangeY = rect.height / 2 - knob.offsetHeight / 2;

  const dx = normX * maxRangeX;
  const dy = -normY * maxRangeY; // Y is inverted visually

  knob.style.left = `${originX + dx}px`;
  knob.style.top = `${originY + dy}px`;
}

function applyDeadZone(value, threshold) {
  if (Math.abs(value) < threshold) return 0.0;
  const sign = value > 0 ? 1 : -1;
  return ((Math.abs(value) - threshold) / (1.0 - threshold)) * sign;
}

function sendJoystickInput(topic, normX, normY) {
  const mapping = {
    left_stick: "left",
    right_stick: "right",
  };

  const key = mapping[topic];
  if (!key) return;

  const dz =
    joystickState[key === "left" ? "dead_zone_left" : "dead_zone_right"];
  const filteredX = applyDeadZone(normX, dz.x);
  const filteredY = applyDeadZone(normY, dz.y);

  localState[key].x = filteredX;
  localState[key].y = filteredY;

  joystickState[key].x = filteredX;
  joystickState[key].y = filteredY;
  dirtyKeys.add(key);

  if (!ticking) startTickLoop();
}

function startTickLoop() {
  ticking = true;
  const tickIntervalMs = 33;

  const tick = () => {
    if (dirtyKeys.size === 0) {
      ticking = false;
      return;
    }

    const payload = { use_web_inputs: joystickState.use_web_inputs };

    for (const key of dirtyKeys) {
      const current = joystickState[key];
      const last = lastSentState[key];

      if (typeof current === "object" && current !== null && "x" in current) {
        // For stick objects
        if (
          Math.abs(current.x - last.x) > 0.001 ||
          Math.abs(current.y - last.y) > 0.001
        ) {
          payload[key] = { x: current.x, y: current.y };
          last.x = current.x;
          last.y = current.y;
        }
      } else if (typeof current === "number") {
        // For triggers
        if (Math.abs(current - last) > 0.001) {
          payload[key] = current;
          lastSentState[key] = current;
        }
      } else if (typeof current === "boolean") {
        // NEW: send button booleans
        if (current !== last) {
          payload[key] = current;
          lastSentState[key] = current;
        }
      }
    }

    dirtyKeys.clear();

    fetch(`${remoteControlServer}/api/joystick_input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch((err) => console.error("POST error:", err));

    setTimeout(tick, tickIntervalMs);
  };

  tick();
}

function createStick(areaId, knobId, topic, autoCenterX, autoCenterY) {
  const area = document.getElementById(areaId);
  const knob = document.getElementById(knobId);

  const setKnob = (x, y) => {
    knob.style.left = `${x}px`;
    knob.style.top = `${y}px`;
  };

  const movePointer = (globalX, globalY) => {
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
    sendJoystickInput(topic, normX, normY);
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
    sendJoystickInput(topic, normX, normY);
  };

  return { movePointer, resetKnob, area };
}

function setupTouchEvents(leftStick, rightStick) {
  const activeTouches = {};

  function touchStartedInArea(touch, area) {
    const rect = area.getBoundingClientRect();
    return (
      touch.clientX >= rect.left &&
      touch.clientX <= rect.right &&
      touch.clientY >= rect.top &&
      touch.clientY <= rect.bottom
    );
  }

  document.addEventListener("touchstart", (e) => {
    allowReadGamePad = false;
    for (const touch of e.changedTouches) {
      if (touchStartedInArea(touch, leftStick.area)) {
        activeTouches[touch.identifier] = {
          side: "left",
          startX: touch.clientX,
          startY: touch.clientY,
        };
      } else if (touchStartedInArea(touch, rightStick.area)) {
        activeTouches[touch.identifier] = {
          side: "right",
          startX: touch.clientX,
          startY: touch.clientY,
        };
      }
    }
  });

  document.addEventListener("touchmove", (e) => {
    for (const touch of e.changedTouches) {
      const data = activeTouches[touch.identifier];
      if (data) {
        const dx = touch.clientX - data.startX;
        const dy = touch.clientY - data.startY;
        const area = data.side === "left" ? leftStick.area : rightStick.area;
        const stick = data.side === "left" ? leftStick : rightStick;
        const rect = area.getBoundingClientRect();
        const centerX = rect.left + area.clientWidth / 2;
        const centerY = rect.top + area.clientHeight / 2;
        stick.movePointer(centerX + dx, centerY + dy);
      }
    }
  });

  document.addEventListener("touchend", handleTouchEnd);
  document.addEventListener("touchcancel", handleTouchEnd);

  function handleTouchEnd(e) {
    allowReadGamePad = true;
    for (const touch of e.changedTouches) {
      const data = activeTouches[touch.identifier];
      if (data) {
        (data.side === "left" ? leftStick : rightStick).resetKnob();
        delete activeTouches[touch.identifier];
      }
    }
  }
}

function setupMouseEvents(leftStick, rightStick) {
  let mouseActive = null;
  let mouseStartX = 0,
    mouseStartY = 0;

  document.addEventListener("mousedown", (e) => {
    allowReadGamePad = false;
    if (leftStick.area.contains(e.target)) {
      mouseActive = "left";
      mouseStartX = e.clientX;
      mouseStartY = e.clientY;
      leftStick.movePointerToCenter();
    } else if (rightStick.area.contains(e.target)) {
      mouseActive = "right";
      mouseStartX = e.clientX;
      mouseStartY = e.clientY;
      rightStick.movePointerToCenter();
    }
  });

  document.addEventListener("mousemove", (e) => {
    if (mouseActive) {
      const dx = e.clientX - mouseStartX;
      const dy = e.clientY - mouseStartY;
      const stick = mouseActive === "left" ? leftStick : rightStick;
      const area = stick.area;
      const rect = area.getBoundingClientRect();
      const centerX = rect.left + area.clientWidth / 2;
      const centerY = rect.top + area.clientHeight / 2;
      stick.movePointer(centerX + dx, centerY + dy);
    }
  });

  document.addEventListener("mouseup", () => {
    allowReadGamePad = true;
    if (mouseActive === "left") leftStick.resetKnob();
    else if (mouseActive === "right") rightStick.resetKnob();
    mouseActive = null;
  });

  leftStick.movePointerToCenter = () => {
    const rect = leftStick.area.getBoundingClientRect();
    leftStick.movePointer(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2
    );
  };
  rightStick.movePointerToCenter = () => {
    const rect = rightStick.area.getBoundingClientRect();
    rightStick.movePointer(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2
    );
  };
}

function setupUIControls() {
  const takeoverBtn = document.getElementById("takeover-button");
  takeoverBtn.classList.add("active");

  takeoverBtn.onclick = () => {
    joystickState.use_web_inputs = !joystickState.use_web_inputs;
    takeoverBtn.classList.toggle("active", joystickState.use_web_inputs);
    takeoverBtn.classList.toggle("inactive", !joystickState.use_web_inputs);
    sendFullState();
  };

  // const deadzoneBindings = [
  //   ["deadzone-left-x", "dead_zone_left", "x"],
  //   ["deadzone-left-y", "dead_zone_left", "y"],
  //   ["deadzone-right-x", "dead_zone_right", "x"],
  //   ["deadzone-right-y", "dead_zone_right", "y"],
  // ];
  //
  // deadzoneBindings.forEach(([id, group, axis]) => {
  //   const slider = document.getElementById(id);
  //   slider.value = joystickState[group][axis];
  //   slider.oninput = () => {
  //     joystickState[group][axis] = parseFloat(slider.value);
  //     dirtyKeys.add(group);
  //     if (!ticking) startTickLoop();
  //   };
  // });

  sendFullState();
}

function sendFullState() {
  fetch(`${remoteControlServer}/api/joystick_input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(joystickState),
  }).catch((err) => console.error("POST error:", err));
}

export default { init, uninit };
