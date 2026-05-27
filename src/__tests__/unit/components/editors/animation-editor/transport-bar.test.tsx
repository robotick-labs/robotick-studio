import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TransportBar } from "../../../../../renderer/components/editors/animation-editor/TransportBar";
import {
  ANIM_PLAYBACK_STATE_PAUSED,
  ANIM_PLAYBACK_STATE_PLAYING,
} from "../../../../../renderer/components/editors/animation-editor/playback-state";

afterEach(() => {
  cleanup();
});

describe("TransportBar", () => {
  it("play/pause button toggles playback state writes", () => {
    const writeAnimControlField = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue();

    const { rerender } = render(
      <TransportBar
        isPlaying={false}
        loopEnabled
        loopResetDurationSec={1}
        durationSec={1}
        playheadSec={0.5}
        playheadSampleStepSec={1 / 30}
        setLocalScrubTimeSec={vi.fn()}
        writeAnimControlField={writeAnimControlField}
        setLoopEnabled={vi.fn()}
        seekPlayheadToTimeSec={vi.fn()}
        onCommitDurationSec={vi.fn()}
        onCommitLoopResetDurationSec={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(writeAnimControlField).toHaveBeenCalledWith("playback_state", ANIM_PLAYBACK_STATE_PLAYING);

    rerender(
      <TransportBar
        isPlaying
        loopEnabled
        loopResetDurationSec={1}
        durationSec={1}
        playheadSec={0.5}
        playheadSampleStepSec={1 / 30}
        setLocalScrubTimeSec={vi.fn()}
        writeAnimControlField={writeAnimControlField}
        setLoopEnabled={vi.fn()}
        seekPlayheadToTimeSec={vi.fn()}
        onCommitDurationSec={vi.fn()}
        onCommitLoopResetDurationSec={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(writeAnimControlField).toHaveBeenCalledWith("playback_state", ANIM_PLAYBACK_STATE_PAUSED);
  });

  it("commits duration and loop reset edits on blur", () => {
    const onCommitDurationSec = vi.fn();
    const onCommitLoopResetDurationSec = vi.fn();

    render(
      <TransportBar
        isPlaying={false}
        loopEnabled
        loopResetDurationSec={0.75}
        durationSec={1.25}
        playheadSec={0.5}
        playheadSampleStepSec={1 / 30}
        setLocalScrubTimeSec={vi.fn()}
        writeAnimControlField={vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue()}
        setLoopEnabled={vi.fn()}
        seekPlayheadToTimeSec={vi.fn()}
        onCommitDurationSec={onCommitDurationSec}
        onCommitLoopResetDurationSec={onCommitLoopResetDurationSec}
      />
    );

    fireEvent.change(screen.getByLabelText("Reset Duration"), { target: { value: "0.50" } });
    fireEvent.blur(screen.getByLabelText("Reset Duration"));
    fireEvent.change(screen.getByLabelText("Duration"), { target: { value: "2.00" } });
    fireEvent.blur(screen.getByLabelText("Duration"));

    expect(onCommitLoopResetDurationSec).toHaveBeenCalledWith(0.5);
    expect(onCommitDurationSec).toHaveBeenCalledWith(2);
  });
});
