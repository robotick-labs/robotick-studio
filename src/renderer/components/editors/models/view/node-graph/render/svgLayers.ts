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
  const existing = {
    swim: svg.querySelector("g.layer-swim") as SVGGElement | null,
    group: svg.querySelector("g.layer-group") as SVGGElement | null,
    edges: svg.querySelector("g.layer-edges") as SVGGElement | null,
    nodes: svg.querySelector("g.layer-nodes") as SVGGElement | null,
  };

  if (existing.swim && existing.group && existing.edges && existing.nodes) {
    return existing as Layers;
  }

  // first-time creation
  const swim = make("layer-swim");
  const group = make("layer-group");
  const edges = make("layer-edges");
  const nodes = make("layer-nodes");

  // fixed ordering: background → top
  svg.append(swim);
  svg.append(group);
  svg.append(edges);
  svg.append(nodes);

  return { swim, group, edges, nodes };

  function make(className: string) {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.classList.add(className);
    return g;
  }
}
