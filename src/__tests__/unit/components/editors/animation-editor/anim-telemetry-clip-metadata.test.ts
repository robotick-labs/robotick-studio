import { describe, expect, it } from "vitest";

import {
  clipDataFromTelemetryMetadata,
  saveButtonPresentation,
} from "../../../../../renderer/components/editors/animation-editor/AnimationEditorPage";

describe("clipDataFromTelemetryMetadata", () => {
  it("accepts channel_names when channels is absent", () => {
    const parsed = clipDataFromTelemetryMetadata({
      service_id: "anim:anim_clips_evaluator",
      clip_identity: {
        clip_name: "expression_idle",
        animclip_path: "content/anim/animclips/expression_idle.animclip.yaml",
      },
      clip_revision: "123",
      duration_sec: 1,
      sample_count: 31,
      channel_names: ["look_offset_x", "look_offset_y"],
    });

    expect(parsed.name).toBe("expression_idle");
    expect(Object.keys(parsed.channels)).toEqual(["look_offset_x", "look_offset_y"]);
    expect(parsed.sampleCount).toBe(31);
    expect(parsed.clipRevision).toBe("123");
  });

  it("parses loop reset duration metadata", () => {
    const parsed = clipDataFromTelemetryMetadata({
      service_id: "anim:anim_clips_evaluator",
      clip_identity: {
        clip_name: "expression_idle",
        animclip_path: "content/anim/animclips/expression_idle.animclip.yaml",
      },
      loop_reset_duration_sec: 0.35,
      duration_sec: 1,
      sample_count: 31,
      channels: ["look_offset_x"],
    });

    expect(parsed.loopResetDurationSec).toBeCloseTo(0.35);
  });
});

describe("saveButtonPresentation", () => {
  it("derives expected button state for dirty and failed saves", () => {
    expect(saveButtonPresentation(true, "dirty")).toEqual({
      label: "Save*",
      title: "Save dirty animation changes.",
      disabled: false,
    });
    expect(saveButtonPresentation(false, "failed")).toEqual({
      label: "Save Failed",
      title: "Retry saving animation changes.",
      disabled: false,
    });
  });
});
