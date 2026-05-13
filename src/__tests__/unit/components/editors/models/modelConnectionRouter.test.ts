import { describe, expect, it } from "vitest";

import type { Node } from "../../../../../renderer/components/editors/models/view/node-graph/layout/editorNodeGraph";
import { RectilinearRouter } from "../../../../../renderer/components/editors/models/view/node-graph/routing/rectilinearRouter";

const nodes = new Map<string, Node>([
  [
    "a",
    {
      id: "a",
      kind: "workload",
      label: "A",
      x: 0,
      y: 0,
      w: 168,
      h: 40,
      lane: 0,
    },
  ],
  [
    "b",
    {
      id: "b",
      kind: "workload",
      label: "B",
      x: 0,
      y: 100,
      w: 168,
      h: 40,
      lane: 0,
    },
  ],
]);

describe("RectilinearRouter", () => {
  it("renders local connections with curved path commands", () => {
    const [edge] = new RectilinearRouter().routeAll(
      [
        {
          from: "a",
          to: "b",
          routePoints: [
            { x: 84, y: 40 },
            { x: 120, y: 80 },
            { x: 84, y: 100 },
          ],
        },
      ],
      (id) => nodes.get(id),
    );

    expect(edge.path).toContain("Q");
    expect(edge.path).toMatch(/^M84,40 /);
    expect(edge.classList).toContain("local-connection");
  });

  it("renders multi-point local connections as continuous cubic splines", () => {
    const [edge] = new RectilinearRouter().routeAll(
      [
        {
          from: "a",
          to: "b",
          routePoints: [
            { x: 84, y: 40 },
            { x: 84, y: 40 },
            { x: 120, y: 80 },
            { x: 84, y: 100 },
          ],
        },
      ],
      (id) => nodes.get(id),
    );

    expect(edge.path).toBe("M84,40 C84,40 84,80 84,100");
    expect(edge.path).not.toContain(" L");
  });

  it("keeps remote connections as straight segmented paths", () => {
    const [edge] = new RectilinearRouter().routeAll(
      [
        {
          from: "a",
          to: "b",
          isRemote: true,
          routePoints: [
            { x: 84, y: 40 },
            { x: 120, y: 80 },
            { x: 84, y: 100 },
          ],
        },
      ],
      (id) => nodes.get(id),
    );

    expect(edge.path).toBe("M84,40 L120,80 L84,100");
    expect(edge.classList).toContain("remote-connection");
  });
});
