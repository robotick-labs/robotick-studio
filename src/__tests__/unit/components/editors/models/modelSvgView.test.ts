import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GraphDoc, type Section } from "../../../../../renderer/components/editors/models/view/node-graph/layout/editorNodeGraph";
import { positionModelHeaders } from "../../../../../renderer/components/editors/models/view/node-graph/layout/buildGraphDocFromModel";
import {
  SvgView,
  createSvgLayers,
} from "../../../../../renderer/components/editors/models/view/node-graph/render/svgView";

const originalGetBBox = SVGSVGElement.prototype.getBBox;
const originalGetComputedTextLength = (SVGElement.prototype as SVGElement & {
  getComputedTextLength?: () => number;
}).getComputedTextLength;

beforeAll(() => {
  Object.defineProperty(SVGSVGElement.prototype, "getBBox", {
    configurable: true,
    value() {
      return { x: 0, y: 0, width: 1600, height: 1200 };
    },
  });
  Object.defineProperty(SVGElement.prototype, "getComputedTextLength", {
    configurable: true,
    value() {
      return 0;
    },
  });
});

afterAll(() => {
  Object.defineProperty(SVGSVGElement.prototype, "getBBox", {
    configurable: true,
    value: originalGetBBox,
  });
  Object.defineProperty(SVGElement.prototype, "getComputedTextLength", {
    configurable: true,
    value: originalGetComputedTextLength,
  });
});

describe("SvgView vertical model rendering", () => {
  it("renders vertical model headers in one row with increasing x transforms", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const layers = createSvgLayers(svg);
    const view = new SvgView(
      svg,
      layers,
      {
        routeAll: () => [],
      },
      "test",
    );
    const doc = new GraphDoc();
    const sections: Section[] = [
      {
        index: 0,
        modelId: "mind",
        yStart: 40,
        laneCount: 0,
        laneHeight: 0,
        maxNodes: 0,
        labelY: 48,
        collapsed: true,
      },
      {
        index: 1,
        modelId: "animator",
        yStart: 220,
        laneCount: 1,
        laneHeight: 240,
        maxNodes: 2,
        labelY: 210,
        collapsed: false,
      },
      {
        index: 2,
        modelId: "face",
        yStart: 520,
        laneCount: 0,
        laneHeight: 0,
        maxNodes: 0,
        labelY: 528,
        collapsed: true,
      },
    ];
    doc.setSections(sections);
    doc.upsertNode({
      id: "mind:model",
      kind: "collapsed-model",
      label: "Mind",
      x: 24,
      y: -32,
      w: 280,
      h: 52,
      lane: 0,
      meta: { modelId: "mind", section: 0, collapsed: true },
    });
    doc.upsertNode({
      id: "animator:model",
      kind: "model",
      label: "Animator",
      x: 24,
      y: 148,
      w: 320,
      h: 52,
      lane: 0,
      meta: { modelId: "animator", section: 1, collapsed: false },
    });
    doc.upsertNode({
      id: "face:model",
      kind: "collapsed-model",
      label: "Face",
      x: 24,
      y: 448,
      w: 300,
      h: 52,
      lane: 0,
      meta: { modelId: "face", section: 2, collapsed: true },
    });
    doc.upsertNode({
      id: "animator:w1",
      kind: "workload",
      label: "One",
      x: 160,
      y: 120,
      w: 140,
      h: 40,
      lane: 0,
      meta: { modelId: "animator", section: 1, slot: 0 },
    });
    doc.upsertNode({
      id: "animator:w2",
      kind: "workload",
      label: "Two",
      x: 160,
      y: 220,
      w: 140,
      h: 40,
      lane: 0,
      meta: { modelId: "animator", section: 1, slot: 1 },
    });

    positionModelHeaders(doc);
    view.render(doc);

    const mind = svg.querySelector("#mind\\:model");
    const animator = svg.querySelector("#animator\\:model");
    const face = svg.querySelector("#face\\:model");
    expect(mind?.getAttribute("transform")).toBe("translate(24,24)");
    const animatorTransform = animator?.getAttribute("transform") ?? "";
    const faceTransform = face?.getAttribute("transform") ?? "";
    expect(animatorTransform).toMatch(/^translate\(\d+,24\)$/);
    expect(faceTransform).toMatch(/^translate\(\d+,24\)$/);

    const animatorX = Number(animatorTransform.match(/^translate\((\d+),24\)$/)?.[1] ?? 0);
    const faceX = Number(faceTransform.match(/^translate\((\d+),24\)$/)?.[1] ?? 0);
    expect(animatorX).toBeGreaterThan(24 + 280);
    expect(faceX).toBeGreaterThan(animatorX + 320);
  });

  it("updates workload selection without rebuilding edge DOM or changing the viewport", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const layers = createSvgLayers(svg);
    const view = new SvgView(
      svg,
      layers,
      {
        routeAll: (edges) =>
          edges.map((edge) => ({
            from: edge.from,
            to: edge.to,
            path: "M0,0 L10,10",
            fromPath: edge.fromPath,
            toPath: edge.toPath,
            classList: ["connection", "local-connection"],
          })),
      },
      "test",
    );
    const doc = new GraphDoc();
    doc.upsertNode({
      id: "animator:w1",
      kind: "workload",
      label: "One",
      x: 100,
      y: 120,
      w: 168,
      h: 40,
      lane: 0,
      meta: { modelId: "animator", section: 0, slot: 0 },
    });
    doc.upsertNode({
      id: "animator:w2",
      kind: "workload",
      label: "Two",
      x: 100,
      y: 220,
      w: 168,
      h: 40,
      lane: 0,
      meta: { modelId: "animator", section: 0, slot: 1 },
    });
    doc.setEdges([
      {
        from: "animator:w1",
        to: "animator:w2",
        routePoints: [
          { x: 184, y: 160 },
          { x: 184, y: 220 },
        ],
      },
    ]);

    view.render(doc, {
      selectedNodeId: null,
      edgeVisibilityMode: "all",
      focusDimming: true,
      expandedModelIds: [],
    });
    const viewBox = svg.getAttribute("viewBox");
    const firstEdgeGroup = svg.querySelector("g.connection-group");
    const firstTransform = svg
      .querySelector("#animator\\:w1")
      ?.getAttribute("transform");

    view.updateSelectionState(doc, {
      selectedNodeId: "animator:w2",
      edgeVisibilityMode: "all",
      focusDimming: true,
      expandedModelIds: [],
    });

    expect(svg.getAttribute("viewBox")).toBe(viewBox);
    expect(svg.querySelector("g.connection-group")).toBe(firstEdgeGroup);
    expect(svg.querySelector("#animator\\:w1")?.getAttribute("transform")).toBe(
      firstTransform,
    );
    expect(svg.querySelector("#animator\\:w2")?.classList.contains("is-selected")).toBe(
      true,
    );
  });

  it("shows connection source and destination labels on edge hover", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    Object.defineProperty(svg, "getScreenCTM", {
      configurable: true,
      value: () => ({
        inverse: () => ({}),
      }),
    });
    Object.defineProperty(svg, "createSVGPoint", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        matrixTransform() {
          return { x: this.x, y: this.y };
        },
      }),
    });
    const layers = createSvgLayers(svg);
    const view = new SvgView(
      svg,
      layers,
      {
        routeAll: (edges) =>
          edges.map((edge) => ({
            from: edge.from,
            to: edge.to,
            path: "M0,0 L10,10",
            fromPath: edge.fromPath,
            toPath: edge.toPath,
            classList: ["connection", "local-connection"],
          })),
      },
      "test",
    );
    const doc = new GraphDoc();
    doc.upsertNode({
      id: "animator:w1",
      kind: "workload",
      label: "Source Node",
      x: 100,
      y: 120,
      w: 168,
      h: 40,
      lane: 0,
      meta: { modelId: "animator", section: 0, slot: 0 },
    });
    doc.upsertNode({
      id: "animator:w2",
      kind: "workload",
      label: "Target Node",
      x: 100,
      y: 220,
      w: 168,
      h: 40,
      lane: 0,
      meta: { modelId: "animator", section: 0, slot: 1 },
    });
    doc.setEdges([
      {
        from: "animator:w1",
        to: "animator:w2",
        fromPath: "w1.outputs.pose",
        toPath: "w2.inputs.pose",
        routePoints: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
      },
    ]);

    view.render(doc, {
      selectedNodeId: null,
      edgeVisibilityMode: "all",
      focusDimming: true,
      expandedModelIds: [],
    });

    const hoverPath = svg.querySelector(
      "path.connection-hover-area",
    ) as SVGPathElement | null;
    hoverPath?.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 120,
        clientY: 140,
      }),
    );

    const tooltip = svg.querySelector("g.connection-tooltip-layer");
    const text = Array.from(
      svg.querySelectorAll("text.connection-tooltip-text"),
    ).map((node) => node.textContent);
    expect(tooltip?.classList.contains("is-hidden")).toBe(false);
    expect(text).toEqual([
      "From: Source Node.outputs.pose",
      "To: Target Node.inputs.pose",
    ]);
  });
});
