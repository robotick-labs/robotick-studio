import { editorSelectionStore } from "../document/editorSelectionStore";

export class SelectionController {
  constructor(
    private svg: SVGSVGElement,
    private selectionScope: string = "default"
  ) {}

  private onClick = (e: MouseEvent) => {
    const g = (e.target as Element).closest("g.workload-node") as
      | SVGGElement
      | null;
    const nodeKind = g?.getAttribute("data-node-kind");
    if (nodeKind === "collapsed-model") {
      const modelId = g?.getAttribute("data-model-id");
      if (modelId) {
        this.svg.dispatchEvent(
          new CustomEvent("models-graph:toggle-model-collapsed", {
            detail: { modelId, scope: this.selectionScope },
            bubbles: true,
          })
        );
      }
      return;
    }
    if (nodeKind === "stub") {
      return;
    }
    const nodeId = g?.id ?? null;
    editorSelectionStore.setSelection(nodeId, this.selectionScope);
    window.dispatchEvent(
      new CustomEvent("models-graph:selection-changed", {
        detail: { nodeId, scope: this.selectionScope },
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
