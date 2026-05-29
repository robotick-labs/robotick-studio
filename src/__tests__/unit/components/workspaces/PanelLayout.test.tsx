import React from "react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";

const registryState = vi.hoisted(() => ({
  entries: [] as Array<{
    id: string;
    label: string;
    module: string;
    Component: React.ComponentType;
    source: "builtin" | "plugin";
  }>,
  loading: false,
}));

vi.mock("../../../../renderer/services/EditorRegistry", () => {
  const MockEditor = () => <div data-testid="mock-editor">mock</div>;
  const AnimationEditor = () => (
    <div data-testid="animation-editor">animation</div>
  );
  const mockEntry = {
    id: "mock-editor",
    label: "Mock Editor",
    module: "mock-module",
    Component: MockEditor,
    source: "builtin" as const,
  };
  const animationEntry = {
    id: "animation-editor",
    label: "Animation Editor",
    module: "animation-module",
    Component: AnimationEditor,
    source: "plugin" as const,
  };
  registryState.entries = [mockEntry];
  return {
    useEditorRegistry: () => ({
      listEditorEntries: () => registryState.entries,
      getEditorEntry: (editorId: string) =>
        registryState.entries.find((entry) => entry.id === editorId),
      loading: registryState.loading,
    }),
    __mockEntries: {
      mockEntry,
      animationEntry,
    },
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
import { __mockEntries } from "../../../../renderer/services/EditorRegistry";

const useContextMenuMock = useContextMenu as unknown as vi.Mock;
const mockEntries = __mockEntries as {
  mockEntry: {
    id: string;
    label: string;
    module: string;
    Component: React.ComponentType;
    source: "builtin";
  };
  animationEntry: {
    id: string;
    label: string;
    module: string;
    Component: React.ComponentType;
    source: "plugin";
  };
};

describe("PanelLayout context menu", () => {
  let showPanelMenu: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    registryState.entries = [mockEntries.mockEntry];
    registryState.loading = false;
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
          workspaceLabel="Mock Workspace"
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

  it("adds workspace layout tabs and persists a per-tab panel layout key", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PanelLayout
          workspaceId="workspace"
          workspaceLabel="Mock Workspace"
          defaultEditorId="mock-editor"
        />
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Mock Workspace | Default");
    const addTab = container.querySelector(
      "button[aria-label='Create layout tab']"
    );
    expect(addTab).not.toBeNull();

    await act(async () => {
      addTab?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        })
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Mock Workspace | New Layout 2");
    const rawTabs = window.localStorage.getItem(
      "workspace-layout-tabs:main:workspace"
    );
    expect(rawTabs).not.toBeNull();
    const tabs = JSON.parse(rawTabs ?? "{}") as {
      activeTabId?: string;
      tabs?: Array<{ id: string; name: string }>;
    };
    expect(tabs.tabs?.map((tab) => tab.name)).toEqual([
      "Mock Workspace | Default",
      "Mock Workspace | New Layout 2",
    ]);
    expect(tabs.activeTabId).toBe(tabs.tabs?.[1]?.id);

    await vi.waitFor(() => {
      expect(
        window.localStorage.getItem(
          `panelLayout:main:workspace:${tabs.activeTabId}`
        )
      ).not.toBeNull();
    });

    act(() => {
      root.unmount();
    });
  });

  it("renames workspace layout tabs inline", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PanelLayout
          workspaceId="workspace"
          workspaceLabel="Mock Workspace"
          defaultEditorId="mock-editor"
        />
      );
      await Promise.resolve();
    });

    const defaultTab = Array.from(
      container.querySelectorAll("[role='button']")
    ).find(
      (button) => button.textContent?.includes("Mock Workspace | Default")
    );
    expect(defaultTab).not.toBeNull();

    await act(async () => {
      defaultTab?.dispatchEvent(
        new MouseEvent("dblclick", {
          bubbles: true,
          cancelable: true,
        })
      );
      await Promise.resolve();
    });

    const input = container.querySelector(
      "input[aria-label='Rename layout tab']"
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();

    await act(async () => {
      if (!input) return;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set?.call(input, "Auditory Work");
      input.dispatchEvent(
        new Event("input", {
          bubbles: true,
          cancelable: true,
        })
      );
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        })
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Auditory Work");
    const rawTabs = window.localStorage.getItem(
      "workspace-layout-tabs:main:workspace"
    );
    const tabs = JSON.parse(rawTabs ?? "{}") as {
      tabs?: Array<{ id: string; name: string }>;
    };
    expect(tabs.tabs?.[0]?.name).toBe("Auditory Work");

    act(() => {
      root.unmount();
    });
  });

  it("reorders workspace layout tabs by dragging and persists the order", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PanelLayout
          workspaceId="workspace"
          workspaceLabel="Mock Workspace"
          defaultEditorId="mock-editor"
        />
      );
      await Promise.resolve();
    });

    const addTab = container.querySelector(
      "button[aria-label='Create layout tab']"
    );
    await act(async () => {
      addTab?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        })
      );
      await Promise.resolve();
    });

    const tabsBefore = Array.from(
      container.querySelectorAll<HTMLElement>("[role='button']")
    );
    const defaultTab = tabsBefore.find(
      (button) => button.textContent?.includes("Mock Workspace | Default")
    );
    const layoutTwoTab = tabsBefore.find(
      (button) => button.textContent?.includes("Mock Workspace | New Layout 2")
    );
    expect(defaultTab).not.toBeNull();
    expect(layoutTwoTab).not.toBeNull();
    const getDefaultTabRect = vi.spyOn(
      defaultTab as HTMLButtonElement,
      "getBoundingClientRect"
    );
    getDefaultTabRect.mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 100,
      bottom: 26,
      left: 0,
      width: 100,
      height: 26,
      toJSON: () => ({}),
    });

    await act(async () => {
      layoutTwoTab?.dispatchEvent(
        new Event("dragstart", {
          bubbles: true,
          cancelable: true,
        })
      );
      await Promise.resolve();
    });

    await act(async () => {
      defaultTab?.dispatchEvent(
        new MouseEvent("dragover", {
          bubbles: true,
          cancelable: true,
          clientX: 10,
        })
      );
      defaultTab?.dispatchEvent(
        new MouseEvent("drop", {
          bubbles: true,
          cancelable: true,
          clientX: 10,
        })
      );
      await Promise.resolve();
    });
    getDefaultTabRect.mockRestore();

    const rawTabs = window.localStorage.getItem(
      "workspace-layout-tabs:main:workspace"
    );
    const tabs = JSON.parse(rawTabs ?? "{}") as {
      tabs?: Array<{ id: string; name: string }>;
    };
    expect(tabs.tabs?.map((tab) => tab.name)).toEqual([
      "Mock Workspace | New Layout 2",
      "Mock Workspace | Default",
    ]);

    act(() => {
      root.unmount();
    });
  });

  it("confirms before closing a workspace layout tab and persists removal", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <PanelLayout
          workspaceId="workspace"
          workspaceLabel="Mock Workspace"
          defaultEditorId="mock-editor"
        />
      );
      await Promise.resolve();
    });

    const addTab = container.querySelector(
      "button[aria-label='Create layout tab']"
    );
    await act(async () => {
      addTab?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        })
      );
      await Promise.resolve();
    });

    const closeButton = container.querySelector(
      "button[aria-label='Close layout tab Mock Workspace | New Layout 2']"
    );
    expect(closeButton).not.toBeNull();

    await act(async () => {
      closeButton?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        })
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Close layout tab?");
    const rawBeforeCancel = window.localStorage.getItem(
      "workspace-layout-tabs:main:workspace"
    );
    expect(rawBeforeCancel).toContain("Mock Workspace | New Layout 2");

    const cancelButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Cancel"
    );
    expect(cancelButton).not.toBeNull();
    await act(async () => {
      cancelButton?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        })
      );
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("Close layout tab?");
    expect(
      window.localStorage.getItem("workspace-layout-tabs:main:workspace")
    ).toContain("Mock Workspace | New Layout 2");

    const closeButtonAfterCancel = container.querySelector(
      "button[aria-label='Close layout tab Mock Workspace | New Layout 2']"
    );
    expect(closeButtonAfterCancel).not.toBeNull();

    await act(async () => {
      closeButtonAfterCancel?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        })
      );
      await Promise.resolve();
    });
    const confirmButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Close tab"
    );
    expect(confirmButton).not.toBeNull();

    await act(async () => {
      confirmButton?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        })
      );
      await Promise.resolve();
    });

    const tabs = JSON.parse(
      window.localStorage.getItem("workspace-layout-tabs:main:workspace") ??
        "{}"
    ) as {
      activeTabId?: string;
      tabs?: Array<{ id: string; name: string }>;
    };
    expect(tabs.tabs?.map((tab) => tab.name)).toEqual([
      "Mock Workspace | Default",
    ]);
    expect(tabs.activeTabId).toBe("default");

    act(() => {
      root.unmount();
    });
  });

  it("updates editor selector options when plugin editors arrive after initial render", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    registryState.entries = [mockEntries.mockEntry];

    await act(async () => {
      root.render(
        <PanelLayout
          workspaceId="workspace"
          workspaceLabel="Mock Workspace"
          defaultEditorId="mock-editor"
        />
      );
      await Promise.resolve();
    });

    const selectorButton = container.querySelector(
      "button[aria-label='Open editor selector']"
    );
    expect(selectorButton).not.toBeNull();

    await act(async () => {
      selectorButton?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        })
      );
      await Promise.resolve();
    });

    let optionLabels = Array.from(container.querySelectorAll("option")).map(
      (option) => option.textContent
    );
    expect(optionLabels).toEqual(["Mock Editor"]);

    registryState.entries = [mockEntries.mockEntry, mockEntries.animationEntry];

    await act(async () => {
      root.render(
        <PanelLayout
          workspaceId="workspace"
          workspaceLabel="Mock Workspace"
          defaultEditorId="mock-editor"
        />
      );
      await Promise.resolve();
    });

    optionLabels = Array.from(container.querySelectorAll("option")).map(
      (option) => option.textContent
    );
    expect(optionLabels).toEqual(["Animation Editor", "Mock Editor"]);

    act(() => {
      root.unmount();
    });
  });

  it("does not overwrite a saved plugin panel layout while editor discovery is still loading", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const savedPluginLayout = JSON.stringify({
      id: "leaf-1",
      kind: "leaf",
      editorId: "animation-editor",
    });

    window.localStorage.setItem(
      "panelLayout:main:workspace:default",
      savedPluginLayout
    );

    registryState.entries = [mockEntries.mockEntry];
    registryState.loading = true;

    await act(async () => {
      root.render(
        <PanelLayout
          workspaceId="workspace"
          workspaceLabel="Mock Workspace"
          defaultEditorId="mock-editor"
        />
      );
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='mock-editor']")).not.toBeNull();
    expect(
      window.localStorage.getItem("panelLayout:main:workspace:default")
    ).toBe(savedPluginLayout);

    registryState.entries = [mockEntries.mockEntry, mockEntries.animationEntry];
    registryState.loading = false;

    await act(async () => {
      root.render(
        <PanelLayout
          workspaceId="workspace"
          workspaceLabel="Mock Workspace"
          defaultEditorId="mock-editor"
        />
      );
      await Promise.resolve();
    });

    expect(
      container.querySelector("[data-testid='animation-editor']")
    ).not.toBeNull();

    act(() => {
      root.unmount();
    });
  });
});
