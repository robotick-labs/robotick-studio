import React, { createContext, useContext } from "react";

const FloatingPanelsScopeContext = createContext<string | null>(null);

export function FloatingPanelsScopeProvider({
  scope,
  children,
}: {
  scope: string;
  children: React.ReactNode;
}) {
  return (
    <FloatingPanelsScopeContext.Provider value={scope}>
      {children}
    </FloatingPanelsScopeContext.Provider>
  );
}

export function useFloatingPanelsScope(): string {
  const scope = useContext(FloatingPanelsScopeContext);
  if (!scope) {
    throw new Error(
      "useFloatingPanelsScope must be used within FloatingPanelsScopeProvider"
    );
  }
  return scope;
}
