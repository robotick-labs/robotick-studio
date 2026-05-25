export interface Layers {
  swim: SVGGElement;
  group: SVGGElement;
  nodes: SVGGElement;
  edges: SVGGElement;
  overlay: SVGGElement;
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
 * Ensure the SVG contains named layer groups and return them.
 *
 * @param svg - The root SVG element to inspect and possibly augment with layer groups
 * @returns An object with `swim`, `group`, `edges`, `nodes`, and `overlay`
 * properties, each an `SVGGElement` representing the corresponding layer;
 * missing layers are created and appended to `svg`
 */
export function createSvgLayers(svg: SVGSVGElement): Layers {
  const swim = ensureLayer("layer-swim");
  const group = ensureLayer("layer-group");
  const edges = ensureLayer("layer-edges");
  const nodes = ensureLayer("layer-nodes");
  const overlay = ensureLayer("layer-overlay");

  // Fixed ordering: background → top.
  svg.append(swim, group, edges, nodes, overlay);

  return { swim, group, edges, nodes, overlay };

  function ensureLayer(className: string) {
    const existing = svg.querySelector(`g.${className}`) as SVGGElement | null;
    if (existing) {
      return existing;
    }
    return make(className);
  }

  function make(className: string): SVGGElement {
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.classList.add(className);
    return g;
  }
}
