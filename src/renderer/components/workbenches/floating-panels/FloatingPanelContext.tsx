import React, { createContext, useContext } from "react";

type PanelSettings = Record<string, unknown>;

export type FloatingPanelContextValue = {
  scope: string;
  id: string;
  title?: string;
  settings: PanelSettings;
  setTitle: (title: string) => void;
  setSettings: (settings: PanelSettings) => void;
  updateSettings: (settings: Partial<PanelSettings>) => void;
  close: () => void;
};

export const FloatingPanelContext =
  createContext<FloatingPanelContextValue | null>(null);

export function useFloatingPanel(): FloatingPanelContextValue {
  const ctx = useContext(FloatingPanelContext);
  if (!ctx) {
    throw new Error(
      "useFloatingPanel must be used inside a floating panel instance"
    );
  }
  return ctx;
}

export function useOptionalFloatingPanel():
  | FloatingPanelContextValue
  | null {
  return useContext(FloatingPanelContext);
}
