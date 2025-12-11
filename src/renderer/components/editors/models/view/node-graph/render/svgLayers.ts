export interface Layers {
  swim: SVGGElement;
  group: SVGGElement;
  nodes: SVGGElement;
  edges: SVGGElement;
}

/**
 * Create an SVG group element and assign it the given id.
 *
 * @param id - The value to set for the element's `id` attribute
 * @returns The created `SVGGElement` (`<g>`) with its `id` set to `id`
 */
export function createSvgLayer(id: string): SVGGElement {
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("id", id);
  return g;
}

/**
 * Ensure the SVG contains four named layer groups and return them.
 *
 * @param svg - The root SVG element to inspect and possibly augment with layer groups
 * @returns An object with `swim`, `group`, `edges`, and `nodes` properties, each an `SVGGElement` representing the corresponding layer; missing layers are created and appended to `svg`
 */
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