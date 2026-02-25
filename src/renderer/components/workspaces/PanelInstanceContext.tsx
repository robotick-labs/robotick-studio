import React from "react";

export type PanelInstanceValue = {
  panelId?: string;
  workspaceId?: string;
};

export const PanelInstanceContext = React.createContext<PanelInstanceValue>({});

export type PanelInstanceProviderProps = PanelInstanceValue & {
  children: React.ReactNode;
};

export function PanelInstanceProvider({
  panelId,
  workspaceId,
  children,
}: PanelInstanceProviderProps) {
  return (
    <PanelInstanceContext.Provider value={{ panelId, workspaceId }}>
      {children}
    </PanelInstanceContext.Provider>
  );
}

export function usePanelInstance() {
  return React.useContext(PanelInstanceContext);
}
