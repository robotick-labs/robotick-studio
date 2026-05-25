export class ConnectionTooltip {
  constructor(private svg: SVGSVGElement) {}

  show(event: MouseEvent, sourceLabel: string, targetLabel: string): void {
    const svgPoint = this.clientToSvgPoint(event.clientX, event.clientY);
    if (!svgPoint) {
      return;
    }

    const tooltip = this.ensureLayer();
    const sourceText = tooltip.querySelectorAll(
      "text.connection-tooltip-text",
    )[0] as SVGTextElement | undefined;
    const targetText = tooltip.querySelectorAll(
      "text.connection-tooltip-text",
    )[1] as SVGTextElement | undefined;
    const background = tooltip.querySelector(
      "rect.connection-tooltip-bg",
    ) as SVGRectElement | null;
    if (!sourceText || !targetText || !background) {
      return;
    }

    sourceText.textContent = `From: ${sourceLabel}`;
    targetText.textContent = `To: ${targetLabel}`;

    const width =
      Math.max(
        sourceText.getComputedTextLength(),
        targetText.getComputedTextLength(),
      ) + 20;
    background.setAttribute("width", String(width));
    background.setAttribute("height", "42");

    tooltip.setAttribute(
      "transform",
      `translate(${svgPoint.x + 16},${svgPoint.y - 12})`,
    );
    tooltip.classList.remove("is-hidden");
  }

  hide(): void {
    const tooltip = this.svg.querySelector(
      "g.connection-tooltip-layer",
    ) as SVGGElement | null;
    tooltip?.classList.add("is-hidden");
  }

  private ensureLayer(): SVGGElement {
    let group = this.svg.querySelector(
      "g.connection-tooltip-layer",
    ) as SVGGElement | null;
    if (group) {
      return group;
    }

    const ns = "http://www.w3.org/2000/svg";
    group = document.createElementNS(ns, "g");
    group.classList.add("connection-tooltip-layer", "is-hidden");
    group.setAttribute("pointer-events", "none");

    const background = document.createElementNS(ns, "rect");
    background.classList.add("connection-tooltip-bg");
    background.setAttribute("rx", "6");
    background.setAttribute("ry", "6");

    const sourceText = document.createElementNS(ns, "text");
    sourceText.classList.add("connection-tooltip-text");
    sourceText.setAttribute("x", "10");
    sourceText.setAttribute("y", "18");

    const targetText = document.createElementNS(ns, "text");
    targetText.classList.add("connection-tooltip-text");
    targetText.setAttribute("x", "10");
    targetText.setAttribute("y", "34");

    group.append(background, sourceText, targetText);
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
