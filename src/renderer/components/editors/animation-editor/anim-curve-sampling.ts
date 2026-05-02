type Point = { t: number; v: number };
type PreparedCurve = {
  points: Point[];
  tangents: number[];
};

function sortByTime(points: Point[]): Point[] {
  return [...points].sort((left, right) => left.t - right.t);
}

function computeMonotoneTangents(points: Point[]): number[] {
  const count = points.length;
  if (count <= 1) return [0];
  if (count === 2) {
    const dt = points[1].t - points[0].t;
    const slope = dt > 1e-6 ? (points[1].v - points[0].v) / dt : 0;
    return [slope, slope];
  }

  const h: number[] = new Array(count - 1);
  const d: number[] = new Array(count - 1);
  for (let index = 0; index < count - 1; index += 1) {
    const dt = points[index + 1].t - points[index].t;
    h[index] = dt;
    d[index] = dt > 1e-6 ? (points[index + 1].v - points[index].v) / dt : 0;
  }

  const m: number[] = new Array(count);
  m[0] = d[0];
  m[count - 1] = d[count - 2];

  for (let index = 1; index < count - 1; index += 1) {
    const dPrev = d[index - 1];
    const dNext = d[index];
    if (dPrev * dNext <= 0) {
      m[index] = 0;
      continue;
    }
    const hPrev = h[index - 1];
    const hNext = h[index];
    const w1 = (2 * hNext) + hPrev;
    const w2 = hNext + (2 * hPrev);
    m[index] = (w1 + w2) / ((w1 / dPrev) + (w2 / dNext));
  }

  for (let index = 0; index < count - 1; index += 1) {
    if (Math.abs(d[index]) <= 1e-8) {
      m[index] = 0;
      m[index + 1] = 0;
      continue;
    }
    const a = m[index] / d[index];
    const b = m[index + 1] / d[index];
    const sum = (a * a) + (b * b);
    if (sum <= 9) continue;
    const scale = 3 / Math.sqrt(sum);
    m[index] = scale * a * d[index];
    m[index + 1] = scale * b * d[index];
  }

  return m;
}

export function sampleCubicHermiteMonotone(points: Point[], timeSec: number): number | null {
  if (!points.length) return null;
  const prepared = prepareMonotoneCurve(points);
  return samplePreparedMonotoneCurve(prepared, timeSec);
}

function prepareMonotoneCurve(points: Point[]): PreparedCurve {
  const sorted = sortByTime(points);
  const tangents = computeMonotoneTangents(sorted);
  return { points: sorted, tangents };
}

function samplePreparedMonotoneCurve(prepared: PreparedCurve, timeSec: number): number | null {
  const sorted = prepared.points;
  const tangents = prepared.tangents;
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0].v;

  if (timeSec <= sorted[0].t) return sorted[0].v;
  const lastIndex = sorted.length - 1;
  if (timeSec >= sorted[lastIndex].t) return sorted[lastIndex].v;

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const next = sorted[index];
    if (timeSec > next.t) continue;

    const dt = next.t - previous.t;
    if (dt <= 1e-6) return next.v;

    const u = (timeSec - previous.t) / dt;
    const u2 = u * u;
    const u3 = u2 * u;

    const m0 = tangents[index - 1];
    const m1 = tangents[index];

    const h00 = (2 * u3) - (3 * u2) + 1;
    const h10 = u3 - (2 * u2) + u;
    const h01 = (-2 * u3) + (3 * u2);
    const h11 = u3 - u2;

    return (h00 * previous.v) + (h10 * (dt * m0)) + (h01 * next.v) + (h11 * (dt * m1));
  }

  return sorted[lastIndex].v;
}

export function buildSampledCurve(points: Point[], durationSec: number, sampleCount = 512): Point[] {
  if (!points.length || durationSec <= 0) return [];
  if (points.length === 1) {
    return [{ t: 0, v: points[0].v }, { t: durationSec, v: points[0].v }];
  }

  const samples = Math.max(2, Math.floor(sampleCount));
  const prepared = prepareMonotoneCurve(points);
  const out: Point[] = [];
  for (let index = 0; index < samples; index += 1) {
    const alpha = index / (samples - 1);
    const t = alpha * durationSec;
    const v = samplePreparedMonotoneCurve(prepared, t);
    if (v === null) continue;
    out.push({ t, v });
  }
  return out;
}
