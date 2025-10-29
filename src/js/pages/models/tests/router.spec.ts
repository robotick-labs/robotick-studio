import { describe, it, expect } from "vitest";
import { RectilinearRouter } from "../core/routing/rectilinearRouter";
import type { Node } from "../core/graphDoc";

const router = new RectilinearRouter();

function N(x: number, y: number): Node {
  return {
    id: "a",
    kind: "workload",
    label: "A",
    x,
    y,
    w: 140,
    h: 40,
    lane: 0,
  };
}

describe("RectilinearRouter", () => {
  it("routes adjacent horizontally as single segment", () => {
    const a = N(0, 0),
      b = N(180, 0);
    const d = router.route(a, b);
    expect(d).toMatch(/^M/);
    expect(d.split("L").length).toBe(2); // single segment after M
  });

  it("routes orthogonally otherwise", () => {
    const a = N(0, 0),
      b = N(500, 60);
    const d = router.route(a, b);
    // Ensure only axis-aligned segments (x or y constant per step)
    const coords = d
      .replace(/[ML]/g, "")
      .trim()
      .split(/\s+/)
      .map((s) => s.split(",").map(Number));
    for (let i = 1; i < coords.length; i++) {
      const [x1, y1] = coords[i - 1];
      const [x2, y2] = coords[i];
      expect(x1 === x2 || y1 === y2).toBe(true);
    }
  });
});
