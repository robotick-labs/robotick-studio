import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TransportBar } from "../../../../../renderer/components/editors/animation-editor/TransportBar";
import { ANIM_PLAYBACK_STATE_PAUSED } from "../../../../../renderer/components/editors/animation-editor/playback-state";

describe("TransportBar", () => {
  it("stop is one-shot: seeks to zero via scrub flow and pauses playback", () => {
    const writeAnimControlField = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue();
    const seekPlayheadToTimeSec = vi.fn();
    const setLocalScrubTimeSec = vi.fn();

    render(
      <TransportBar
        isPlaying
        loopEnabled
        durationSec={1}
        playheadSec={0.5}
        playheadSampleStepSec={1 / 30}
        setLocalScrubTimeSec={setLocalScrubTimeSec}
        writeAnimControlField={writeAnimControlField}
        setLoopEnabled={vi.fn()}
        seekPlayheadToTimeSec={seekPlayheadToTimeSec}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    expect(setLocalScrubTimeSec).toHaveBeenCalledWith(null);
    expect(writeAnimControlField).toHaveBeenCalledWith("time_override_sec", 0);
    expect(writeAnimControlField).toHaveBeenCalledWith("playback_state", ANIM_PLAYBACK_STATE_PAUSED);
    expect(seekPlayheadToTimeSec).not.toHaveBeenCalled();
  });
});
