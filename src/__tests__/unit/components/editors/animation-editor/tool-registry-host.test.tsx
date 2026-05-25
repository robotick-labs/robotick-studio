import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolHost } from "../../../../../renderer/components/editors/animation-editor/tools/ToolHost";
import { listAnimationTools } from "../../../../../renderer/components/editors/animation-editor/tools/registry";
import type { AnimationToolSettingsContext } from "../../../../../renderer/components/editors/animation-editor/tools/types";

function makeContext(): AnimationToolSettingsContext {
  return {
    durationSec: 1,
    lineSnapStart: true,
    lineSnapEnd: true,
    setLineSnapStart: vi.fn(),
    setLineSnapEnd: vi.fn(),
    rangeMidpointSec: 0.225,
    rangeMidpointDraft: "0.225",
    setRangeMidpointDraft: vi.fn(),
    setSelectedTimeRangeMidpointSec: vi.fn(),
    rangeSizeSec: 0.45,
    rangeSizeDraft: "0.450",
    setRangeSizeDraft: vi.fn(),
    setSelectedTimeRangeDurationSec: vi.fn(),
    rangeFalloffSec: 0.12,
    rangeFalloffDraft: "0.120",
    setRangeFalloffDraft: vi.fn(),
    setRangeFalloffSec: vi.fn(),
    rangeFalloffCurve: 1,
    rangeFalloffCurveDraft: "1.00",
    setRangeFalloffCurveDraft: vi.fn(),
    setRangeFalloffCurve: vi.fn(),
    warpMode: "time+value",
    setWarpMode: vi.fn(),
    warpTimeStrength: 1,
    warpTimeStrengthDraft: "1.00",
    setWarpTimeStrengthDraft: vi.fn(),
    setWarpTimeStrength: vi.fn(),
    warpValueStrength: 1,
    warpValueStrengthDraft: "1.00",
    setWarpValueStrengthDraft: vi.fn(),
    setWarpValueStrength: vi.fn(),
    warpLockEndpoints: true,
    setWarpLockEndpoints: vi.fn(),
    smoothRangeSec: 0.45,
    smoothRangeDraft: "0.450",
    setSmoothRangeDraft: vi.fn(),
    setSmoothRangeSec: vi.fn(),
    smoothFalloffSec: 0.18,
    smoothFalloffDraft: "0.180",
    setSmoothFalloffDraft: vi.fn(),
    setSmoothFalloffSec: vi.fn(),
    smoothFalloffCurve: 1,
    smoothFalloffCurveDraft: "1.00",
    setSmoothFalloffCurveDraft: vi.fn(),
    setSmoothFalloffCurve: vi.fn(),
    smoothStrength: 0.65,
    smoothStrengthDraft: "0.65",
    setSmoothStrengthDraft: vi.fn(),
    setSmoothStrength: vi.fn(),
    smoothApplyRateHz: 60,
    smoothApplyRateDraft: "60",
    setSmoothApplyRateDraft: vi.fn(),
    setSmoothApplyRateHz: vi.fn(),
    smoothRangeStepSec: 0.01,
    rangeFalloffStepSec: 0.01,
  };
}

describe("animation tool registry + host", () => {
  it("exposes expected tools", () => {
    const tools = listAnimationTools();
    const ids = tools.map((tool) => tool.id);
    expect(ids).toContain("Pencil");
    expect(ids).toContain("Line");
    expect(ids).toContain("Range");
    expect(ids).toContain("Warp");
    expect(ids).toContain("Smooth");
  });

  it("renders settings for active tool and handles toggle", () => {
    const onToggleTool = vi.fn();
    render(
      <ToolHost
        tools={listAnimationTools()}
        activeTool={"Line"}
        onToggleTool={onToggleTool}
        settingsContext={makeContext()}
      />
    );

    expect(screen.getByRole("button", { name: "Snap Start" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Range" }));
    expect(onToggleTool).toHaveBeenCalledWith("Range");
  });
});
