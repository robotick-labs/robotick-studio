import React from "react";
import {
  PanelContextMenu,
  type PanelContextMenuProps,
} from "../workbenches/PanelContextMenu";
import { HeaderContextMenu } from "../header/HeaderContextMenu";

type PanelMenuRequest = Omit<PanelContextMenuProps, "onClose">;

type HeaderMenuRequest = {
  x: number;
  y: number;
};

type ContextMenuState =
  | { kind: "panel"; payload: PanelMenuRequest }
  | { kind: "header"; payload: HeaderMenuRequest };

type ContextMenuContextValue = {
  showPanelMenu: (payload: PanelMenuRequest) => void;
  showHeaderMenu: (payload: HeaderMenuRequest) => void;
};

const ContextMenuContext = React.createContext<ContextMenuContextValue | null>(
  null
);

export function ContextMenuProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [activeMenu, setActiveMenu] = React.useState<ContextMenuState | null>(
    null
  );

  const hideMenu = React.useCallback(() => {
    setActiveMenu(null);
  }, []);

  const showPanelMenu = React.useCallback((payload: PanelMenuRequest) => {
    setActiveMenu({ kind: "panel", payload });
  }, []);

  const showHeaderMenu = React.useCallback((payload: HeaderMenuRequest) => {
    setActiveMenu({ kind: "header", payload });
  }, []);

  return (
    <ContextMenuContext.Provider value={{ showPanelMenu, showHeaderMenu }}>
      {children}
      {activeMenu?.kind === "panel" && (
        <PanelContextMenu {...activeMenu.payload} onClose={hideMenu} />
      )}
      {activeMenu?.kind === "header" && (
        <HeaderContextMenu {...activeMenu.payload} onClose={hideMenu} />
      )}
    </ContextMenuContext.Provider>
  );
}

export function useContextMenu() {
  const context = React.useContext(ContextMenuContext);
  if (!context) {
    throw new Error("useContextMenu must be used within a ContextMenuProvider");
  }
  return context;
}
