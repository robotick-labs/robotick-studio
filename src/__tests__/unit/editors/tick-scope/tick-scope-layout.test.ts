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

function inChain(span: TickScopeWorkSpan, snapChainId: string): TickScopeWorkSpan {
  span.snapChainId = snapChainId;
  return span;
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

  it("renders overlapping sequenced-group children before their enclosing group row", () => {
    const lanes = packSpansIntoSubLanes([
      span("sequenced_group_workload_2805B754", 0, 0.2),
      span("expressive_state_workload_FC09EB3E", 0.04, 0.06),
      span("anim_clips_evaluator_workload_12AF4D01", 0.08, 0.1),
    ]);

    expect(lanes).toHaveLength(2);
    expect(lanes[0].map((item) => item.workload)).toEqual([
      "expressive_state_workload_FC09EB3E",
      "anim_clips_evaluator_workload_12AF4D01",
    ]);
    expect(lanes[1].map((item) => item.workload)).toEqual([
      "sequenced_group_workload_2805B754",
    ]);
  });

  it("keeps staged sleep contiguous with the preceding workload span", () => {
    const coarseSleep = inChain(span("coarse sleep", 0.005, 16.4, "sleep_coarse"), "workload");
    coarseSleep.snapStartToPreviousEnd = true;

    const lanes = packSpansIntoSubLanes([
      inChain(span("workload", 0.004, 0.008), "workload"),
      coarseSleep,
      inChain(span("yield", 16.4, 16.6, "sleep_yield"), "workload"),
    ]);

    expect(lanes).toHaveLength(1);
    expect(laneHasNoOverlaps(lanes[0])).toBe(true);
    expect(lanes[0][1]).toMatchObject({
      workload: "coarse sleep",
      startMs: 0.008,
    });
  });

  it("keeps pre-work phases, useful work, and staged sleep on one row when smoothing nudges boundaries", () => {
    const useful = inChain(span("workload", 0.006, 0.012), "workload");
    useful.snapStartToPreviousEnd = true;
    const coarseSleep = inChain(span("coarse sleep", 0.01, 16.4, "sleep_coarse"), "workload");
    coarseSleep.snapStartToPreviousEnd = true;

    const lanes = packSpansIntoSubLanes([
      inChain(span("engine I/O", 0, 0.008, "engine_io"), "workload"),
      useful,
      coarseSleep,
    ]);

    expect(lanes).toHaveLength(1);
    expect(lanes[0].map((item) => item.workload)).toEqual([
      "engine I/O",
      "workload",
      "coarse sleep",
    ]);
    expect(lanes[0][1].startMs).toBe(0.008);
    expect(lanes[0][2].startMs).toBe(0.012);
  });

  it("keeps thread sleep on the parent group row when group spans enclose inline children", () => {
    const lanes = packSpansIntoSubLanes([
      span("root_group", 0.15, 0.23),
      span("child_workload", 0.16, 0.22),
      span("coarse sleep", 0.23, 16.4, "sleep_coarse"),
    ]);

    expect(lanes).toHaveLength(2);
    expect(lanes[0].map((item) => item.workload)).toEqual(["child_workload"]);
    expect(lanes[1].map((item) => item.workload)).toEqual([
      "root_group",
      "coarse sleep",
    ]);
  });

  it("keeps parent phases with the group row even when workload input order is not chronological", () => {
    const rootGroup = inChain(span("root_group", 0.12, 0.23), "root");
    rootGroup.snapStartToPreviousEnd = true;
    const coarseSleep = inChain(span("coarse sleep", 0.23, 16.4, "sleep_coarse"), "root");
    coarseSleep.snapStartToPreviousEnd = true;

    const lanes = packSpansIntoSubLanes([
      inChain(span("child_workload", 0.16, 0.22), "child"),
      inChain(span("engine I/O", 0.03, 0.15, "engine_io"), "root"),
      rootGroup,
      coarseSleep,
    ]);

    expect(lanes).toHaveLength(2);
    expect(lanes[0].map((item) => item.workload)).toEqual(["child_workload"]);
    expect(lanes[1].map((item) => item.workload)).toEqual([
      "engine I/O",
      "root_group",
      "coarse sleep",
    ]);
    expect(lanes[1][1].startMs).toBe(0.15);
  });
});
