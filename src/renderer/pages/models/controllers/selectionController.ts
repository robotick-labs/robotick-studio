import { editorSelectionStore } from "../document/editorSelectionStore";

export class SelectionController {
  constructor(private svg: SVGSVGElement) {}
  attach(): void {
    this.svg.addEventListener("click", (e) => {
      const g = (e.target as Element).closest(
        "g.workload-node"
      ) as SVGGElement | null;
      if (g?.id) {
        editorSelectionStore.setSelection(g.id);
        window.dispatchEvent(
          new CustomEvent("models-graph:selection-changed", {
            detail: { nodeId: g.id },
          })
        );
      }
    });
  }
}
