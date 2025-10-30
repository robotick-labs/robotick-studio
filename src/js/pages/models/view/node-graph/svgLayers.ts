export interface Layers {
  swim: SVGGElement;
  group: SVGGElement;
  nodes: SVGGElement;
  edges: SVGGElement;
}

export function createSvgLayer(id: string): SVGGElement {
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("id", id);
  return g;
}

export function createSvgLayers(svg: SVGSVGElement): Layers {
  const swim = createSvgLayer("swimlanes-layer");
  const group = createSvgLayer("groups-layer");
  const edges = createSvgLayer("connections-layer");
  const nodes = createSvgLayer("nodes-layer");
  svg.append(swim, group, edges, nodes);
  return { swim, group, nodes, edges };
}
