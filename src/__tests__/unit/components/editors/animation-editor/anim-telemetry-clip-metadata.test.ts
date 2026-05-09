import { describe, expect, it } from "vitest";

import { clipDataFromTelemetryMetadata } from "../../../../../renderer/components/editors/animation-editor/AnimationEditorPage";

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
});
