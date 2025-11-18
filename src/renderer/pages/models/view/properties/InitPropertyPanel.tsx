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
  panelSelector: string,
  store: DocumentStore
): PropertyPanelAPI {
  const host = document.querySelector(panelSelector) as HTMLElement | null;
  if (!host) throw new Error(`${panelSelector} not found`);
  const root: Root = createRoot(host);

  const render = () => {
    root.render(<PropertyPanel store={store} />);
  };

  render();
  return {
    render,
    dispose: () => root.unmount(),
  };
}
