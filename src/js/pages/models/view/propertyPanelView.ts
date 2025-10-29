import { editorState } from "../core/editorState";
import type { GraphDoc } from "../core/graphDoc";
import type { Workload } from "../services/projectModelsLoader.ts";

export class PropertyPanelView {
  private root: HTMLElement;
  constructor(rootId = "property-panel") {
    const el = document.getElementById(rootId);
    if (!el) throw new Error("#property-panel not found");
    this.root = el;
  }

  render(doc: GraphDoc) {
    const id = editorState.selection;
    const node = id ? doc.getNode(id) : null;
    const type =
      node?.kind === "workload"
        ? node.meta?.type ?? "Workload"
        : node?.kind ?? "-";

    this.root.innerHTML = `<h3>Properties <span style="font-weight: normal">| ${type}</span></h3>`;

    console.log("Selected node:", node);
    console.log("Has workload?", node?.workload);

    if (!node || node.kind !== "workload" || node.workload == null) return;

    const workload = node.workload;

    console.log(workload);

    // --- Core section ---
    this.root.appendChild(
      this.renderSection("Core", {
        name: workload.name,
        type: workload.type ?? "",
        tick_rate_hz: workload.tick_rate_hz?.toString() ?? "60",
      })
    );

    // --- Config section ---
    this.root.appendChild(this.renderSection("Config", workload.config));

    // --- Inputs section ---
    this.root.appendChild(this.renderSection("Inputs", workload.inputs));
  }

  private renderSection(
    title: string,
    fields: Record<string, string>
  ): HTMLElement {
    const section = document.createElement("div");
    section.className = "prop-section";

    const heading = document.createElement("h4");
    heading.textContent = title;
    section.appendChild(heading);

    for (const [key, val] of Object.entries(fields)) {
      const label = document.createElement("label");

      const span = document.createElement("span");
      span.textContent = key;

      const input = document.createElement("input");
      input.type = "text";
      input.value = val;
      input.dataset.prop = key;

      label.appendChild(span);
      label.appendChild(input);
      section.appendChild(label);
    }

    return section;
  }
}
