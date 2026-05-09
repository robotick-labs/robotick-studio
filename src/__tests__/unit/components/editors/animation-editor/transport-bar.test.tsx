import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TransportBar } from "../../../../../renderer/components/editors/animation-editor/TransportBar";
import {
  ANIM_PLAYBACK_STATE_PAUSED,
  ANIM_PLAYBACK_STATE_PLAYING,
} from "../../../../../renderer/components/editors/animation-editor/playback-state";

describe("TransportBar", () => {
  it("play/pause button toggles playback state writes", () => {
    const writeAnimControlField = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue();

    const { rerender } = render(
      <TransportBar
        isPlaying={false}
        loopEnabled
        durationSec={1}
        playheadSec={0.5}
        playheadSampleStepSec={1 / 30}
        setLocalScrubTimeSec={vi.fn()}
        writeAnimControlField={writeAnimControlField}
        setLoopEnabled={vi.fn()}
        seekPlayheadToTimeSec={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(writeAnimControlField).toHaveBeenCalledWith("playback_state", ANIM_PLAYBACK_STATE_PLAYING);

    rerender(
      <TransportBar
        isPlaying
        loopEnabled
        durationSec={1}
        playheadSec={0.5}
        playheadSampleStepSec={1 / 30}
        setLocalScrubTimeSec={vi.fn()}
        writeAnimControlField={writeAnimControlField}
        setLoopEnabled={vi.fn()}
        seekPlayheadToTimeSec={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(writeAnimControlField).toHaveBeenCalledWith("playback_state", ANIM_PLAYBACK_STATE_PAUSED);
  });
});
