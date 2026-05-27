import { describe, expect, it } from "vitest";

import {
  channelMaskFromSelection,
  channelSelectionFromMask,
} from "../../../../../renderer/components/editors/animation-editor/recording-state";

describe("recording-state helpers", () => {
  it("round-trips channel masks against active clip channel order", () => {
    const channelNames = ["look_x", "look_y", "jaw_open"];
    const mask = channelMaskFromSelection(channelNames, { look_x: true, jaw_open: true });
    expect(mask).toBe(0b101);
    expect(channelSelectionFromMask(channelNames, mask)).toEqual({
      look_x: true,
      look_y: false,
      jaw_open: true,
    });
  });
});
