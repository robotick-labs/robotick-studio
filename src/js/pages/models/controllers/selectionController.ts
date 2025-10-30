import { editorState } from "./editorState";

export class SelectionController {
  constructor(private svg: SVGSVGElement) {}
  attach(): void {
    this.svg.addEventListener("click", (e) => {
      const g = (e.target as Element).closest(
        "g.workload-node"
      ) as SVGGElement | null;
      if (g?.id) {
        editorState.selection = g.id;
        window.dispatchEvent(
          new CustomEvent("models:selection-changed", {
            detail: { nodeId: g.id },
          })
        );
      }
    });
  }
}
