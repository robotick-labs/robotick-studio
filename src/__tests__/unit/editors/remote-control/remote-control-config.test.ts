import { describe, expect, it } from "vitest";
import {
  applyDeadZone,
  applyShapeTransform,
  applyStickModeTransform,
  normalizeRemoteControlsConfig,
  parseTargetBinding,
} from "../../../../renderer/components/editors/remote-control/components/remote-controls/remote-control-config";

describe("remote-control-config", () => {
  it("normalizes stick modes and direct field targets from Studio config", () => {
    const config = normalizeRemoteControlsConfig({
      sticks: {
        left: {
          selectedMode: "drive_wheels",
          modes: {
            none: {},
            drive_wheels: {
              shapeTransform: "CircleToSquare",
              deadZone: {
                x: 0.1,
                y: 0.2,
              },
              scale: {
                x: 0.5,
                y: 0.75,
              },
              outputs: {
                x: "demo-robot-spine.spine_interface.inputs.angular_speed_norm",
                y: "demo-robot-spine.spine_interface.inputs.linear_speed_norm",
              },
            },
          },
        },
      },
      buttons: {
        left_stick_button: "demo-robot-face.face_control.inputs.blink_request",
      },
    });

    expect(config.sticks.left?.selectedMode).toBe("drive_wheels");
    expect(config.sticks.left?.modes.drive_wheels.outputs.x?.modelName).toBe(
      "demo-robot-spine"
    );
    expect(config.sticks.left?.modes.drive_wheels.outputs.y?.fieldPath).toBe(
      "spine_interface.inputs.linear_speed_norm"
    );
    expect(config.sticks.left?.modes.drive_wheels.scale).toEqual({
      x: 0.5,
      y: 0.75,
    });
    expect(config.buttons.left_stick_button?.fieldPath).toBe(
      "face_control.inputs.blink_request"
    );
    expect(parseTargetBinding("demo-robot-spine..inputs.linear_speed_norm")).toBeNull();
  });

  it("applies the CircleToSquare transform before per-axis dead-zones", () => {
    const shaped = applyShapeTransform(
      { x: 0.5, y: 0.5 },
      "CircleToSquare"
    );
    expect(shaped.x).toBeCloseTo(Math.SQRT1_2, 5);
    expect(shaped.y).toBeCloseTo(Math.SQRT1_2, 5);

    expect(applyDeadZone(0.05, 0.1)).toBe(0);
    expect(applyDeadZone(0.55, 0.1)).toBeCloseTo(0.5, 5);
    expect(applyDeadZone(0.5, -0.5)).toBeCloseTo(0.5, 5);
    expect(applyDeadZone(0.995, 1.5)).toBeCloseTo(0.5, 5);
    expect(applyDeadZone(0.5, Number.NaN)).toBeCloseTo(0.5, 5);

    const transformed = applyStickModeTransform(
      { x: 0.5, y: 0.5 },
      {
        id: "drive_wheels",
        label: "Drive Wheels",
        shapeTransform: "CircleToSquare",
        deadZone: {
          x: 0.1,
          y: 0.1,
        },
        scale: {
          x: 1,
          y: 1,
        },
        outputs: {},
      }
    );
    expect(transformed.x).toBeGreaterThan(0.65);
    expect(transformed.y).toBeGreaterThan(0.65);
  });

  it("can skip shape transforms for square-gated pointer stick values", () => {
    const transformed = applyStickModeTransform(
      { x: 1, y: 1 },
      {
        id: "drive_wheels",
        label: "Drive Wheels",
        shapeTransform: "CircleToSquare",
        deadZone: {
          x: 0,
          y: 0,
        },
        scale: {
          x: 1,
          y: 1,
        },
        outputs: {},
      },
      { applyShapeTransform: false }
    );

    expect(transformed).toEqual({ x: 1, y: 1 });
  });

  it("applies per-axis scale after dead-zones and clamps the result", () => {
    const transformed = applyStickModeTransform(
      { x: 0.55, y: -0.5 },
      {
        id: "look_direction_head",
        label: "Look Direction Head",
        shapeTransform: "None",
        deadZone: {
          x: 0.1,
          y: 0,
        },
        scale: {
          x: 0.5,
          y: 3,
        },
        outputs: {},
      }
    );

    expect(transformed.x).toBeCloseTo(0.25, 5);
    expect(transformed.y).toBe(-1);
  });
});
