export type TickScopeSpanKind =
  | "useful"
  | "miss"
  | "carry"
  | "engine_io"
  | "sync_wait"
  | "local_inputs"
  | "sleep"
  | "sleep_coarse"
  | "sleep_yield"
  | "sleep_spin";

export type TickScopeWorkSpan = {
  workload: string;
  kind: TickScopeSpanKind;
  startMs: number;
  endMs: number;
  cpuStart: number;
  cpuEnd: number;
  carryOutMs?: number;
  snapStartToPreviousEnd?: boolean;
  snapChainId?: string;
};

export type TickScopeSpanStyle = {
  left: string;
  width: string;
};

export function getSpanVisibleWidthPct(span: TickScopeWorkSpan, periodMs: number): number {
  const safePeriodMs = Number.isFinite(periodMs) && periodMs > 0 ? periodMs : 0.001;
  const startPct = Math.max(0, Math.min(100, (span.startMs / safePeriodMs) * 100));
  const endPct = Math.max(0, Math.min(100, (span.endMs / safePeriodMs) * 100));
  return Math.max(0, endPct - startPct);
}

export function getSpanBlockStyle(span: TickScopeWorkSpan, periodMs: number): TickScopeSpanStyle {
  const safePeriodMs = Number.isFinite(periodMs) && periodMs > 0 ? periodMs : 0.001;
  const startPct = Math.max(0, Math.min(100, (span.startMs / safePeriodMs) * 100));
  const widthPct = getSpanVisibleWidthPct(span, periodMs);
  return {
    left: `${startPct}%`,
    width: `${widthPct}%`,
  };
}

export function packSpansIntoSubLanes(spans: TickScopeWorkSpan[]): TickScopeWorkSpan[][] {
  const sortedSpans = [...spans].sort((lhs, rhs) => {
    const startDelta = lhs.startMs - rhs.startMs;
    if (startDelta !== 0) return startDelta;
    const durationDelta = lhs.endMs - lhs.startMs - (rhs.endMs - rhs.startMs);
    if (durationDelta !== 0) return durationDelta;
    return lhs.workload.localeCompare(rhs.workload);
  });

  const previousEndMsByChain = new Map<string, number>();
  const normalizedSpans = sortedSpans.map((span) => {
    const previousChainEndMs =
      span.snapChainId == null ? null : previousEndMsByChain.get(span.snapChainId) ?? null;
    const startMs =
      span.snapStartToPreviousEnd && previousChainEndMs != null
        ? previousChainEndMs
        : span.startMs;
    const endMs = Math.max(startMs, span.endMs);
    if (span.snapChainId != null) {
      previousEndMsByChain.set(
        span.snapChainId,
        Math.max(previousChainEndMs ?? Number.NEGATIVE_INFINITY, endMs),
      );
    }
    return startMs === span.startMs && endMs === span.endMs
      ? span
      : { ...span, startMs, endMs };
  });

  const lanes: TickScopeWorkSpan[][] = [];
  const laneEnds: number[] = [];

  for (const span of normalizedSpans) {
    let laneIndex = laneEnds.findIndex((endMs) => span.startMs >= endMs);
    if (laneIndex < 0) {
      laneIndex = lanes.length;
      lanes.push([]);
      laneEnds.push(Number.NEGATIVE_INFINITY);
    }

    lanes[laneIndex].push(span);
    laneEnds[laneIndex] = Math.max(laneEnds[laneIndex], span.endMs);
  }

  return lanes.reverse();
}
