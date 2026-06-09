import React from "react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";

import { PanelContextMenu } from "../../../../renderer/components/workbenches/PanelContextMenu";

describe("PanelContextMenu assign submenu", () => {
  const baseProps = {
    state: {
      panelId: "panel-a",
      editorId: "editor-a",
      x: 10,
      y: 20,
      horizontalRatio: 0.5,
      verticalRatio: 0.5,
    },
    editorOptions: [
      { id: "editor-a", label: "Tool A" },
      { id: "editor-b", label: "Tool B" },
    ],
    canClose: true,
    isMaximized: false,
    onSplit: vi.fn(),
    onAssign: vi.fn(),
    onToggleMaximize: vi.fn(),
    onClosePanel: vi.fn(),
    onResetLayout: vi.fn(),
    onClose: vi.fn(),
    onCreateFloatingPanel: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("expands the assign submenu without closing the menu", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    act(() => {
      root.render(<PanelContextMenu {...baseProps} />);
    });

    const heading = container.querySelector(
      "[data-testid='context-menu-heading-button']"
    ) as HTMLElement | null;
    expect(heading).not.toBeNull();
    expect(
      container.querySelector("[data-testid='context-menu-submenu']")
    ).toBeNull();

    await act(async () => {
      heading?.dispatchEvent(
        new MouseEvent("mouseover", {
          bubbles: true,
          cancelable: true,
        })
      );
      await Promise.resolve();
    });
    expect(container.querySelector("[data-testid='context-menu-submenu']")).not.toBeNull();

    act(() => {
      heading?.dispatchEvent(
        new MouseEvent("mouseout", {
          bubbles: true,
          cancelable: true,
        })
      );
    });
    expect(baseProps.onClose).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });
});
