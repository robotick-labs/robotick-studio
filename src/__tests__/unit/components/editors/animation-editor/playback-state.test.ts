import { describe, expect, it } from "vitest";

import {
  isAnimPlaybackActive,
  nextShuttlePlaybackRate,
  playbackDirection,
} from "../../../../../renderer/components/editors/animation-editor/playback-state";

describe("playback-state", () => {
  it("treats non-zero rate or recording as active playback", () => {
    expect(isAnimPlaybackActive(0)).toBe(false);
    expect(isAnimPlaybackActive(1)).toBe(true);
    expect(isAnimPlaybackActive(-2)).toBe(true);
    expect(isAnimPlaybackActive(0, true)).toBe(true);
    expect(isAnimPlaybackActive(null)).toBe(false);
  });

  it("derives playback direction and next shuttle speeds", () => {
    expect(playbackDirection(-2)).toBe(-1);
    expect(playbackDirection(0)).toBe(0);
    expect(playbackDirection(4)).toBe(1);
    expect(nextShuttlePlaybackRate(0, 1)).toBe(1);
    expect(nextShuttlePlaybackRate(1, 1)).toBe(2);
    expect(nextShuttlePlaybackRate(2, 1)).toBe(4);
    expect(nextShuttlePlaybackRate(4, 1)).toBe(4);
    expect(nextShuttlePlaybackRate(4, -1)).toBe(-1);
  });
});
