// src/js/components/editors/models/view/properties/initPropertyPanel.tsx
import React from "react";
import { createRoot, Root } from "react-dom/client";
import { PropertyPanel } from "./PropertyPanel";
import type { DocumentStore } from "../../document/documentStore";

export type PropertyPanelAPI = {
  render: () => void;
  dispose?: () => void;
};

type ManagedRoot = {
  disposed: boolean;
  root: Root;
  unmountTimer: number | null;
};

const managedRoots = new WeakMap<HTMLElement, ManagedRoot>();

export function initPropertyPanel(
  hostElement: HTMLElement | null,
  store: DocumentStore,
  selectionScope: string,
  projectPath: string
): PropertyPanelAPI {
  if (!hostElement) {
    throw new Error("initPropertyPanel requires a host element");
  }
  let managedRoot = managedRoots.get(hostElement);
  if (!managedRoot) {
    managedRoot = {
      disposed: false,
      root: createRoot(hostElement),
      unmountTimer: null,
    };
    managedRoots.set(hostElement, managedRoot);
  } else if (managedRoot.unmountTimer != null) {
    window.clearTimeout(managedRoot.unmountTimer);
    managedRoot.unmountTimer = null;
    managedRoot.disposed = false;
  }

  const render = () => {
    if (managedRoot.disposed) {
      return;
    }
    managedRoot.root.render(
      <PropertyPanel
        store={store}
        selectionScope={selectionScope}
        projectPath={projectPath}
      />
    );
  };

  render();
  return {
    render,
    dispose: () => {
      if (managedRoot.disposed) {
        return;
      }
      managedRoot.disposed = true;
      // This root is nested inside the main React tree via an imperative host div.
      // Defer unmount so React is not asked to tear down another root mid-render.
      managedRoot.unmountTimer = window.setTimeout(() => {
        managedRoot.root.unmount();
        managedRoots.delete(hostElement);
        managedRoot.unmountTimer = null;
      }, 0);
    },
  };
}
