export class WorkloadTooltip {
  constructor(private svg: SVGSVGElement) {}

  show(
    event: MouseEvent,
    workloadName: string,
    workloadType: string,
    workloadId: string,
  ): void {
    const svgPoint = this.clientToSvgPoint(event.clientX, event.clientY);
    if (!svgPoint) {
      return;
    }

    const tooltip = this.ensureLayer();
    const lines = Array.from(
      tooltip.querySelectorAll("text.workload-tooltip-text"),
    ) as SVGTextElement[];
    const background = tooltip.querySelector(
      "rect.workload-tooltip-bg",
    ) as SVGRectElement | null;
    if (lines.length !== 3 || !background) {
      return;
    }

    lines[0].textContent = `Name: ${workloadName}`;
    lines[1].textContent = `Type: ${workloadType}`;
    lines[2].textContent = `Id: ${workloadId}`;

    const width =
      Math.max(...lines.map((line) => line.getComputedTextLength())) + 20;
    background.setAttribute("width", String(width));
    background.setAttribute("height", "58");

    tooltip.setAttribute(
      "transform",
      `translate(${svgPoint.x + 16},${svgPoint.y - 12})`,
    );
    tooltip.classList.remove("is-hidden");
  }

  hide(): void {
    const tooltip = this.svg.querySelector(
      "g.workload-tooltip-layer",
    ) as SVGGElement | null;
    tooltip?.classList.add("is-hidden");
  }

  private ensureLayer(): SVGGElement {
    let group = this.svg.querySelector(
      "g.workload-tooltip-layer",
    ) as SVGGElement | null;
    if (group) {
      return group;
    }

    const ns = "http://www.w3.org/2000/svg";
    group = document.createElementNS(ns, "g");
    group.classList.add("workload-tooltip-layer", "is-hidden");
    group.setAttribute("pointer-events", "none");

    const background = document.createElementNS(ns, "rect");
    background.classList.add("workload-tooltip-bg");
    background.setAttribute("rx", "6");
    background.setAttribute("ry", "6");

    const lineYPositions = [18, 34, 50];
    for (const y of lineYPositions) {
      const text = document.createElementNS(ns, "text");
      text.classList.add("workload-tooltip-text");
      text.setAttribute("x", "10");
      text.setAttribute("y", String(y));
      group.appendChild(text);
    }

    group.prepend(background);
    this.svg.appendChild(group);
    return group;
  }

  private clientToSvgPoint(
    clientX: number,
    clientY: number,
  ): { x: number; y: number } | null {
    const ctm = this.svg.getScreenCTM();
    if (!ctm) {
      return null;
    }
    const point = this.svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const world = point.matrixTransform(ctm.inverse());
    return { x: world.x, y: world.y };
  }
}
