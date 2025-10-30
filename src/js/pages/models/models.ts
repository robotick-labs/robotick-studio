import { GraphDoc } from "./view/editorNodeGraph";
import { RectilinearRouter } from "./view/routing/rectilinearRouter";
import { SvgView, createSvgLayers } from "./view/svgView";
import { loadAllModels } from "./services/projectModelsLoader";

import { ModelStore } from "./document/documentStore";
import { buildGraphDocFromModel } from "./view/layout/project";
import { SlotDragController } from "./controllers/slotDragController";
import { SelectionController } from "./controllers/selectionController";
import { PropertyPanelView } from "./view/propertyPanelView";

const nodeSize = { width: 140, height: 40 } as const;
const marginX = 20,
  spacing = 180;

export async function init(): Promise<void> {
  const el = document.getElementById("graph");
  if (!el || !(el instanceof SVGSVGElement)) {
    throw new Error("#graph <svg> not found or not an SVGSVGElement");
  }
  const svg = el as SVGSVGElement;
  const layers = createSvgLayers(svg);

  const doc = new GraphDoc();
  const store = new ModelStore();
  const router = new RectilinearRouter();
  const view = new SvgView(svg, layers, router);
  const props = new PropertyPanelView();

  // initial load
  const models = await loadAllModels();
  store.load(models);
  const summary = buildGraphDocFromModel(store, doc);

  const finalWidth =
    marginX * 2 +
    120 +
    (Math.max(summary.globalMaxNodes, 1) - 1) * spacing +
    nodeSize.width +
    40;
  const finalHeight = summary.totalHeight;

  const renderAll = () => {
    const s = buildGraphDocFromModel(store, doc);
    const w =
      marginX * 2 +
      120 +
      (Math.max(s.globalMaxNodes, 1) - 1) * spacing +
      nodeSize.width +
      40;
    view.render(doc, { width: w, height: s.totalHeight });
    props.render(doc);
    new SlotDragController(svg, doc, view, store).attachAll();
  };

  view.render(doc, { width: finalWidth, height: finalHeight });
  props.render(doc);

  // controllers
  new SelectionController(svg).attach();
  new SlotDragController(svg, doc, view, store).attachAll();

  // events
  window.addEventListener("models:store-updated", renderAll);

  window.addEventListener("models:plus-click", (e: any) => {
    const { sectionIndex, laneIndex } = e.detail;
    const section = doc.sections[sectionIndex];
    const modelId = section.modelId;
    const nextName = suggestName(store, modelId, "NewWorkload");
    store.insertAt(modelId, laneIndex, section.maxNodes, {
      name: nextName,
      type: "TemplateWorkload",
    });
    renderAll();
  });

  window.addEventListener("models:selection-changed", () => props.render(doc));

  window.addEventListener("models:rename-requested", (e: any) => {
    const { nodeId, newName } = e.detail;
    const n = doc.getNode(nodeId);
    if (!n) return;
    const modelId = n.meta?.modelId!;
    store.rename(modelId, n.label, newName);
    renderAll();
  });
}

function suggestName(store: ModelStore, modelId: string, base: string): string {
  let i = 1;
  const m = store.get(modelId)!;
  const exists = (name: string) => m.workloads.some((w) => w.name === name);
  while (exists(`${base}${i}`)) i++;
  return `${base}${i}`;
}
