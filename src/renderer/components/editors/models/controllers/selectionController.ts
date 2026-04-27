import { editorSelectionStore } from "../document/editorSelectionStore";

export class SelectionController {
  constructor(private svg: SVGSVGElement) {}

  private onClick = (e: MouseEvent) => {
    const g = (e.target as Element).closest("g.workload-node") as
      | SVGGElement
      | null;
    const nodeId = g?.id ?? null;
    editorSelectionStore.setSelection(nodeId);
    window.dispatchEvent(
      new CustomEvent("models-graph:selection-changed", {
        detail: { nodeId },
      })
    );
  };

  attach(): void {
    this.svg.addEventListener("click", this.onClick);
  }

  detach(): void {
    this.svg.removeEventListener("click", this.onClick);
  }
}
