import { describe, expect, it } from "vitest";
import {
  getSpanBlockStyle,
  packSpansIntoSubLanes,
  type TickScopeWorkSpan,
} from "../../../../renderer/components/editors/tick-scope/internal/tick-scope-layout";

function span(
  workload: string,
  startMs: number,
  endMs: number,
  kind: TickScopeWorkSpan["kind"] = "useful",
): TickScopeWorkSpan {
  return {
    workload,
    kind,
    startMs,
    endMs,
    cpuStart: 0,
    cpuEnd: 0,
  };
}

function laneHasNoOverlaps(lane: TickScopeWorkSpan[]): boolean {
  const sorted = [...lane].sort((lhs, rhs) => lhs.startMs - rhs.startMs);
  return sorted.every((item, index) => index === 0 || item.startMs >= sorted[index - 1].endMs);
}

describe("Tick Scope layout", () => {
  it("uses exact span percentages without imposing a minimum visual width", () => {
    const sleepStyle = getSpanBlockStyle(span("sleep/yield", 0.166, 16.666, "sleep"), 16.667);
    expect(Number.parseFloat(sleepStyle.left)).toBeCloseTo(0.99598, 5);
    expect(Number.parseFloat(sleepStyle.width)).toBeCloseTo(98.99802, 5);

    const tinyStyle = getSpanBlockStyle(span("tiny", 0.005, 0.007), 16.667);
    expect(Number.parseFloat(tinyStyle.left)).toBeCloseTo(0.029999, 6);
    expect(Number.parseFloat(tinyStyle.width)).toBeCloseTo(0.012, 6);
  });

  it("keeps non-overlapping spans in a single sub-lane", () => {
    const lanes = packSpansIntoSubLanes([
      span("local inputs", 0.005, 0.006, "local_inputs"),
      span("workload", 0.006, 0.011),
      span("sleep/yield", 0.011, 16.6, "sleep"),
    ]);

    expect(lanes).toHaveLength(1);
    expect(laneHasNoOverlaps(lanes[0])).toBe(true);
  });

  it("splits overlapping parent/group phases away from child workload phases", () => {
    const lanes = packSpansIntoSubLanes([
      span("expressive_state_workload_FC09EB3E", 0.005, 0.007),
      span("anim_clips_evaluator_workload_12AF4D01", 0.029, 0.037),
      span("face_control_state_workload_077FD99C", 0.039, 0.04),
      span("engine I/O", 0.004, 0.126, "engine_io"),
      span("sequenced_group_workload_2805B754", 0.126, 0.166),
      span("sleep/yield", 0.166, 16.666, "sleep"),
    ]);

    expect(lanes.length).toBeGreaterThan(1);
    expect(lanes.every(laneHasNoOverlaps)).toBe(true);
    expect(lanes.flat().map((item) => item.workload)).toContain("sleep/yield");
  });
});
