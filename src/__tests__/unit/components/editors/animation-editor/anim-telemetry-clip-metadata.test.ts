import { describe, expect, it } from "vitest";

import {
  clipDataFromTelemetryMetadata,
  saveButtonPresentation,
  selectTelemetryWorkload,
} from "../../../../../renderer/components/editors/animation-editor/anim-editor-shared";

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
      label: "Save",
      title: "Save dirty animation changes.",
      disabled: false,
      tone: "dirty",
      showDirtyDot: true,
    });
    expect(saveButtonPresentation(false, "failed")).toEqual({
      label: "Save Failed",
      title: "Retry saving animation changes.",
      disabled: false,
      tone: "failed",
      showDirtyDot: false,
    });
  });
});

describe("selectTelemetryWorkload", () => {
  it("falls back to the discovered anim service workload name when the preferred name mismatches", () => {
    expect(
      selectTelemetryWorkload(
        [{ name: "actual_anim_workload" }],
        "stale_model_workload_name",
        "actual_anim_workload"
      )
    ).toEqual({ name: "actual_anim_workload" });
  });
});
