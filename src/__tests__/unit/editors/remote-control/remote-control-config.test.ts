import { describe, expect, it } from "vitest";
import {
  applyDeadZone,
  applyShapeTransform,
  applyStickModeTransform,
  normalizeRemoteControlsConfig,
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
              outputs: {
                x: "barr-e-spine.spine_interface.inputs.angular_speed_norm",
                y: "barr-e-spine.spine_interface.inputs.linear_speed_norm",
              },
            },
          },
        },
      },
      buttons: {
        left_stick_button:
          "barr-e-brain.non_drive_control_toggle.inputs.rc_blink_request",
      },
    });

    expect(config.sticks.left?.selectedMode).toBe("drive_wheels");
    expect(config.sticks.left?.modes.drive_wheels.outputs.x?.modelName).toBe(
      "barr-e-spine"
    );
    expect(config.sticks.left?.modes.drive_wheels.outputs.y?.fieldPath).toBe(
      "spine_interface.inputs.linear_speed_norm"
    );
    expect(config.buttons.left_stick_button?.fieldPath).toBe(
      "non_drive_control_toggle.inputs.rc_blink_request"
    );
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
        outputs: {},
      },
      { applyShapeTransform: false }
    );

    expect(transformed).toEqual({ x: 1, y: 1 });
  });
});
