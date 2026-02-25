import React from "react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";

vi.mock("../../../../renderer/services/EditorRegistry", () => {
  const MockEditor = () => <div data-testid="mock-editor">mock</div>;
  const entry = {
    id: "mock-editor",
    label: "Mock Editor",
    module: "mock-module",
    Component: MockEditor,
  };
  return {
    listEditorEntries: () => [entry],
    getEditorEntry: () => entry,
  };
});

vi.mock("../../../../renderer/components/workspaces/floating-panels", () => ({
  FloatingPanelLayer: () => <div data-testid="floating-layer" />,
  FloatingPanelsScopeProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  spawnFloatingPanel: vi.fn(),
}));

const contextMenuModule = vi.hoisted(() => ({
  useContextMenu: vi.fn(),
}));

vi.mock(
  "../../../../renderer/components/context-menu/ContextMenuProvider",
  () => contextMenuModule,
);

import { PanelLayout } from "../../../../renderer/components/workspaces/PanelLayout";
import { useContextMenu } from "../../../../renderer/components/context-menu/ContextMenuProvider";

const useContextMenuMock = useContextMenu as unknown as vi.Mock;

describe("PanelLayout context menu", () => {
  let showPanelMenu: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    showPanelMenu = vi.fn();
    useContextMenuMock.mockReturnValue({
      showPanelMenu,
      showHeaderMenu: vi.fn(),
    });
  });

  it("delegates context menu requests without crashing", () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    act(() => {
      root.render(
        <PanelLayout
          workspaceId="workspace"
          defaultEditorId="mock-editor"
        />
      );
    });

    const editor = container.querySelector("[data-testid='mock-editor']");
    expect(editor).not.toBeNull();

    act(() => {
      editor?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 20,
        })
      );
    });

    expect(showPanelMenu).toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });
});
