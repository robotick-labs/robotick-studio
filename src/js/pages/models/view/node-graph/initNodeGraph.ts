// src/js/pages/models/view/node-graph/initNodeGraph.ts
import { GraphDoc } from "./editorNodeGraph";
import { createSvgLayers, SvgView } from "./svgView";
import { RectilinearRouter } from "./routing/rectilinearRouter";
import { ModelStore } from "../../document/documentStore";
import { buildGraphDocFromModel } from "./layout/project";
import { SlotDragController } from "../../controllers/slotDragController";
import { SelectionController } from "../../controllers/selectionController";

export const nodeSize = { width: 140, height: 40 } as const;
export const marginX = 20;
export const spacing = 180;

export type NodeGraphAPI = {
  svg: SVGSVGElement;
  view: SvgView;
  render: () => void;
  attachControllers: () => void;
};

export function initNodeGraph(
  svgSelector: string,
  doc: GraphDoc,
  store: ModelStore
): NodeGraphAPI {
  const svgEl = document.querySelector(svgSelector);
  if (!svgEl || !(svgEl instanceof SVGSVGElement)) {
    throw new Error(`${svgSelector} not found or not an SVGSVGElement`);
  }

  const layers = createSvgLayers(svgEl);
  const router = new RectilinearRouter();
  const view = new SvgView(svgEl, layers, router);

  const computeSize = () => {
    const s = buildGraphDocFromModel(store, doc);
    const width =
      marginX * 2 +
      120 +
      (Math.max(s.globalMaxNodes, 1) - 1) * spacing +
      nodeSize.width +
      40;
    const height = s.totalHeight;
    return { width, height };
  };

  const render = () => {
    const { width, height } = computeSize();
    view.render(doc, { width, height });
  };

  const attachControllers = () => {
    new SelectionController(svgEl).attach();
    new SlotDragController(svgEl, doc, view, store).attachAll();
  };

  // react to store changes
  store.subscribe(render);

  // graph-specific events live here
  
  window.addEventListener("models:plus-click", (e: any) => {
    const { sectionIndex, laneIndex } = e.detail;
    const section = doc.sections[sectionIndex];
    const modelId = section.modelId;
    const nextName = suggestName(store, modelId, "NewWorkload");
    store.insertAt(modelId, laneIndex, section.maxNodes, {
      name: nextName,
      type: "TemplateWorkload",
    });
  });

  window.addEventListener("models:rename-requested", (e: any) => {
    const { nodeId, newName } = e.detail;
    const n = doc.getNode(nodeId);
    if (!n) return;
    const modelId = n.meta?.modelId!;
    store.rename(modelId, n.label, newName);
  });

  return { svg: svgEl, view, render, attachControllers };
}

function suggestName(store: ModelStore, modelId: string, base: string): string {
  let i = 1;
  const m = store.get(modelId)!;
  const exists = (name: string) => m.workloads.some((w) => w.name === name);
  while (exists(`${base}${i}`)) i++;
  return `${base}${i}`;
}

