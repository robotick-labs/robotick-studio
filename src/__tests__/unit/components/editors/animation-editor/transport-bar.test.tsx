import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TransportBar } from "../../../../../renderer/components/editors/animation-editor/TransportBar";

afterEach(() => {
  cleanup();
});

describe("TransportBar", () => {
  it("writes forward, reverse, stop, and record transport state", async () => {
    const writeAnimControlField = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue();

    const { rerender } = render(
      <TransportBar
        playbackRate={0}
        isRecording={false}
        loopEnabled
        loopResetDurationSec={1}
        durationSec={1}
        canStartRecording
        playheadSec={0.5}
        playheadSampleStepSec={1 / 30}
        recordRequested={false}
        recordingStartHint={"Record overwrite into the active clip."}
        writeAnimControlField={writeAnimControlField}
        setLoopEnabled={vi.fn()}
        seekPlayheadToTimeSec={vi.fn()}
        onCommitDurationSec={vi.fn()}
        onCommitLoopResetDurationSec={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => {
      expect(writeAnimControlField).toHaveBeenNthCalledWith(1, "record_enabled", false);
      expect(writeAnimControlField).toHaveBeenNthCalledWith(2, "playback_rate", 1);
    });

    writeAnimControlField.mockClear();
    rerender(
      <TransportBar
        playbackRate={1}
        isRecording={false}
        loopEnabled
        loopResetDurationSec={1}
        durationSec={1}
        canStartRecording
        playheadSec={0.5}
        playheadSampleStepSec={1 / 30}
        recordRequested={false}
        recordingStartHint={"Record overwrite into the active clip."}
        writeAnimControlField={writeAnimControlField}
        setLoopEnabled={vi.fn()}
        seekPlayheadToTimeSec={vi.fn()}
        onCommitDurationSec={vi.fn()}
        onCommitLoopResetDurationSec={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Play Reverse" }));
    await waitFor(() => {
      expect(writeAnimControlField).toHaveBeenNthCalledWith(1, "record_enabled", false);
      expect(writeAnimControlField).toHaveBeenNthCalledWith(2, "playback_rate", -1);
    });

    writeAnimControlField.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => {
      expect(writeAnimControlField).toHaveBeenNthCalledWith(1, "record_enabled", false);
      expect(writeAnimControlField).toHaveBeenNthCalledWith(2, "playback_rate", 0);
    });

    writeAnimControlField.mockClear();
    rerender(
      <TransportBar
        playbackRate={0}
        isRecording={false}
        loopEnabled
        loopResetDurationSec={1}
        durationSec={1}
        canStartRecording
        playheadSec={0.5}
        playheadSampleStepSec={1 / 30}
        recordRequested={false}
        recordingStartHint={"Record overwrite into the active clip."}
        writeAnimControlField={writeAnimControlField}
        setLoopEnabled={vi.fn()}
        seekPlayheadToTimeSec={vi.fn()}
        onCommitDurationSec={vi.fn()}
        onCommitLoopResetDurationSec={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() => {
      expect(writeAnimControlField).toHaveBeenNthCalledWith(1, "loop", false);
      expect(writeAnimControlField).toHaveBeenNthCalledWith(2, "playback_rate", 1);
      expect(writeAnimControlField).toHaveBeenNthCalledWith(3, "record_enabled", true);
    });
  });

  it("supports J/K/L shortcuts and ramps forward shuttle speed", async () => {
    const writeAnimControlField = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue();

    const { rerender } = render(
      <TransportBar
        playbackRate={0}
        isRecording={false}
        loopEnabled
        loopResetDurationSec={1}
        durationSec={1}
        canStartRecording
        playheadSec={0.5}
        playheadSampleStepSec={1 / 30}
        recordRequested={false}
        recordingStartHint={"Record overwrite into the active clip."}
        writeAnimControlField={writeAnimControlField}
        setLoopEnabled={vi.fn()}
        seekPlayheadToTimeSec={vi.fn()}
        onCommitDurationSec={vi.fn()}
        onCommitLoopResetDurationSec={vi.fn()}
      />
    );

    fireEvent.keyDown(window, { code: "KeyL" });
    await waitFor(() => {
      expect(writeAnimControlField).toHaveBeenNthCalledWith(1, "record_enabled", false);
      expect(writeAnimControlField).toHaveBeenNthCalledWith(2, "playback_rate", 1);
    });

    writeAnimControlField.mockClear();
    rerender(
      <TransportBar
        playbackRate={1}
        isRecording={false}
        loopEnabled
        loopResetDurationSec={1}
        durationSec={1}
        canStartRecording
        playheadSec={0.5}
        playheadSampleStepSec={1 / 30}
        recordRequested={false}
        recordingStartHint={"Record overwrite into the active clip."}
        writeAnimControlField={writeAnimControlField}
        setLoopEnabled={vi.fn()}
        seekPlayheadToTimeSec={vi.fn()}
        onCommitDurationSec={vi.fn()}
        onCommitLoopResetDurationSec={vi.fn()}
      />
    );

    fireEvent.keyDown(window, { code: "KeyL" });
    await waitFor(() => {
      expect(writeAnimControlField).toHaveBeenNthCalledWith(1, "record_enabled", false);
      expect(writeAnimControlField).toHaveBeenNthCalledWith(2, "playback_rate", 2);
    });

    writeAnimControlField.mockClear();
    fireEvent.keyDown(window, { code: "KeyJ" });
    await waitFor(() => {
      expect(writeAnimControlField).toHaveBeenNthCalledWith(1, "record_enabled", false);
      expect(writeAnimControlField).toHaveBeenNthCalledWith(2, "playback_rate", -1);
    });

    writeAnimControlField.mockClear();
    fireEvent.keyDown(window, { code: "KeyK" });
    await waitFor(() => {
      expect(writeAnimControlField).toHaveBeenNthCalledWith(1, "record_enabled", false);
      expect(writeAnimControlField).toHaveBeenNthCalledWith(2, "playback_rate", 0);
    });
  });

  it("commits duration and loop reset edits on blur", () => {
    const onCommitDurationSec = vi.fn();
    const onCommitLoopResetDurationSec = vi.fn();

    render(
      <TransportBar
        playbackRate={0}
        isRecording={false}
        loopEnabled
        loopResetDurationSec={0.75}
        durationSec={1.25}
        canStartRecording
        playheadSec={0.5}
        playheadSampleStepSec={1 / 30}
        recordRequested={false}
        recordingStartHint={"Record overwrite into the active clip."}
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

  it("routes paused arrow-key scrubbing and current-field edits through seekPlayheadToTimeSec", () => {
    const seekPlayheadToTimeSec = vi.fn();

    render(
      <TransportBar
        playbackRate={0}
        isRecording={false}
        loopEnabled
        loopResetDurationSec={0.75}
        durationSec={1.25}
        canStartRecording
        playheadSec={0.5}
        playheadSampleStepSec={0.1}
        recordRequested={false}
        recordingStartHint={"Record overwrite into the active clip."}
        writeAnimControlField={vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue()}
        setLoopEnabled={vi.fn()}
        seekPlayheadToTimeSec={seekPlayheadToTimeSec}
        onCommitDurationSec={vi.fn()}
        onCommitLoopResetDurationSec={vi.fn()}
      />
    );

    fireEvent.keyDown(window, { code: "ArrowRight" });
    fireEvent.keyDown(window, { code: "ArrowRight", shiftKey: true });
    fireEvent.change(screen.getByLabelText("Current"), { target: { value: "0.85" } });

    expect(seekPlayheadToTimeSec).toHaveBeenNthCalledWith(1, 0.6);
    expect(seekPlayheadToTimeSec).toHaveBeenNthCalledWith(2, 1.5);
    expect(seekPlayheadToTimeSec).toHaveBeenNthCalledWith(3, 0.85);
  });
});
