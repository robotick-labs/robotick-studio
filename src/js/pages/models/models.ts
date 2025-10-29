// Entry for the models feature with Doc/View architecture
import { GraphDoc } from "./core/graphDoc";
import { RectilinearRouter } from "./core/routing/rectilinearRouter";
import { SvgView, createSvgLayers } from "./view/svgView";
import { DragController } from "./controllers/dragController";
import { loadAllModels } from "./services/projectModelsLoader";
import { buildInitialDoc } from "./core/layout/layout";

const nodeSize = { width: 140, height: 40 } as const;
const marginX = 20;
const spacing = 180;

export async function init(): Promise<void> {
  const el = document.getElementById("graph");
  if (!el || !(el instanceof SVGSVGElement)) {
    throw new Error("#graph <svg> not found or not an SVGSVGElement");
  }
  const svg = el as SVGSVGElement;
  const layers = createSvgLayers(svg);

  const doc = new GraphDoc();
  const router = new RectilinearRouter();
  const view = new SvgView(svg, layers, router);

  const models = await loadAllModels();
  const summary = buildInitialDoc(doc, models);

  // Compute final width & height like the original file:
  const finalWidth =
    marginX * 2 +
    120 +
    (Math.max(summary.globalMaxNodes, 1) - 1) * spacing +
    nodeSize.width +
    40;
  const finalHeight = summary.totalHeight;
  // Render with explicit canvas size and fixed-width swimlanes
  view.render(doc, { width: finalWidth, height: finalHeight });

  // Dragging
  const drag = new DragController(svg, doc, view);
  drag.attachAll();
}
