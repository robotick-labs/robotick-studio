type SelectionControllerHandlers = {
  onSelectNode: (nodeId: string | null) => void;
  onToggleCollapsedModel: (modelId: string) => void;
};

export class SelectionController {
  constructor(
    private svg: SVGSVGElement,
    private handlers: SelectionControllerHandlers,
  ) {}

  private onClick = (e: MouseEvent) => {
    const g = (e.target as Element).closest("g.workload-node") as
      | SVGGElement
      | null;
    const nodeKind = g?.getAttribute("data-node-kind");
    if (nodeKind === "model" || nodeKind === "collapsed-model") {
      const modelId = g?.getAttribute("data-model-id");
      const toggleTarget = (e.target as Element).closest(".model-toggle-button");
      if (modelId && toggleTarget) {
        this.handlers.onToggleCollapsedModel(modelId);
        return;
      }
    }
    if (nodeKind === "stub") {
      return;
    }
    const nodeId = g?.id ?? null;
    this.handlers.onSelectNode(nodeId);
  };

  attach(): void {
    this.svg.addEventListener("click", this.onClick);
  }

  detach(): void {
    this.svg.removeEventListener("click", this.onClick);
  }
}
