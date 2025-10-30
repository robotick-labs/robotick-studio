// src/js/pages/models/view/properties/initPropertyPanel.tsx
import React from "react";
import { createRoot, Root } from "react-dom/client";
import type { GraphDoc } from "../node-graph/editorNodeGraph";
import { PropertyPanel } from "./PropertyPanel";

export type PropertyPanelAPI = {
  render: () => void; // re-render with current doc
  updateDoc: (doc: GraphDoc) => void; // swap doc ref then render
};

export function initPropertyPanel(
  panelSelector: string,
  initialDoc: GraphDoc
): PropertyPanelAPI {
  const host = document.querySelector(panelSelector) as HTMLElement | null;
  if (!host) throw new Error(`${panelSelector} not found`);

  const root: Root = createRoot(host);
  let currentDoc = initialDoc;

  const render = () => {
    root.render(<PropertyPanel doc={currentDoc} />);
  };

  const updateDoc = (doc: GraphDoc) => {
    currentDoc = doc;
    render();
  };

  // initial paint
  render();

  return { render, updateDoc };
}
