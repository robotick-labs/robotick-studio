// src/js/pages/models/view/properties/initPropertyPanel.tsx
import React from "react";
import { createRoot, Root } from "react-dom/client";
import { PropertyPanel } from "./PropertyPanel";
import type { DocumentStore } from "../../document/documentStore";

export type PropertyPanelAPI = {
  render: () => void;
  dispose?: () => void;
};

export function initPropertyPanel(
  hostElement: HTMLElement | null,
  store: DocumentStore
): PropertyPanelAPI {
  if (!hostElement) {
    throw new Error("initPropertyPanel requires a host element");
  }
  const root: Root = createRoot(hostElement);

  const render = () => {
    root.render(<PropertyPanel store={store} />);
  };

  render();
  return {
    render,
    dispose: () => root.unmount(),
  };
}
