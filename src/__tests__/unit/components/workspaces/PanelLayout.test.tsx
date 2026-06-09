import React from "react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { parse } from "yaml";

const registryState = vi.hoisted(() => ({
  entries: [] as Array<{
    id: string;
    label: string;
    module: string;
    Component: React.ComponentType;
    source: "builtin" | "plugin";
  }>,
  loading: false,
  missingEditorIds: new Set<string>(),
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
        registryState.missingEditorIds.has(editorId)
          ? undefined
          : registryState.entries.find((entry) => entry.id === editorId),
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
  clearFloatingPanels: vi.fn(),
  replaceFloatingPanels: vi.fn(),
  spawnFloatingPanel: vi.fn(),
  subscribeFloatingPanels: vi.fn(() => () => {}),
}));

const projectContextState = vi.hoisted(() => ({
  projectPath: "/repo/robots/barr-e/barr-e.project.yaml",
}));

vi.mock(
  "../../../../renderer/data-sources/launcher/internal/ProjectContext",
  () => ({
    useProjectContext: () => ({
      projectPath: projectContextState.projectPath,
      launcherProfile: "local:ALL",
      setProjectPath: vi.fn(),
      setLauncherProfile: vi.fn(),
    }),
  }),
);

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

class MemoryStudioPersistenceStore {
  files = new Map<string, string>();

  async readStudioDocument(_projectPath: string) {
    return this.files.get("studio/studio.yaml") ?? null;
  }

  async writeStudioDocument(_projectPath: string, content: string) {
    this.files.set("studio/studio.yaml", content);
  }
}

function readStudioDocument(store: MemoryStudioPersistenceStore): any | null {
  const raw = store.files.get("studio/studio.yaml");
  return raw ? parse(raw) : null;
}

function readWorkbench(store: MemoryStudioPersistenceStore, workspaceId: string) {
  return readStudioDocument(store)?.windows?.[0]?.workbenches?.find(
    (workbench: { id?: string }) => workbench.id === workspaceId
  );
}

function readLayout(
  store: MemoryStudioPersistenceStore,
  workspaceId: string,
  layoutId: string
) {
  return readWorkbench(store, workspaceId)?.layouts?.find(
    (layout: { id?: string }) => layout.id === layoutId
  );
}

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
  let studioStore: MemoryStudioPersistenceStore;

  beforeEach(() => {
    window.localStorage.clear();
    projectContextState.projectPath = "/repo/robots/barr-e/barr-e.project.yaml";
    studioStore = new MemoryStudioPersistenceStore();
    window.robotick = {
      ...(window.robotick ?? {}),
      studioPersistence: studioStore,
    };
    registryState.entries = [mockEntries.mockEntry];
    registryState.loading = false;
    registryState.missingEditorIds = new Set();
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

  it("does not load or write legacy layout state when no project is selected", async () => {
    projectContextState.projectPath = null as unknown as string;
    window.localStorage.setItem(
      "workspace-layout-tabs:main:workspace",
      JSON.stringify({
        tabs: [{ id: "legacy", name: "Legacy Layout" }],
        activeTabId: "legacy",
      })
    );
    window.localStorage.setItem(
      "panelLayout:main:workspace:legacy",
      JSON.stringify({
        id: "legacy-panel",
        kind: "leaf",
        editorId: "animation-editor",
      })
    );

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
    expect(container.textContent).not.toContain("Legacy Layout");
    expect(container.querySelector("[data-testid='mock-editor']")).not.toBeNull();

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

    expect(container.textContent).toContain("Mock Workspace | New Layout 2");
    expect(window.localStorage.getItem("workspace-layout-tabs:main:workspace")).toBe(
      JSON.stringify({
        tabs: [{ id: "legacy", name: "Legacy Layout" }],
        activeTabId: "legacy",
      })
    );
    expect(window.localStorage.getItem("panelLayout:main:workspace:legacy")).toBe(
      JSON.stringify({
        id: "legacy-panel",
        kind: "leaf",
        editorId: "animation-editor",
      })
    );

    act(() => {
      root.unmount();
    });
  });

  it("keeps missing-editor panels interactive so they can be reassigned", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      registryState.entries = [mockEntries.mockEntry, mockEntries.animationEntry];
      root.render(
        <PanelLayout
          workspaceId="workspace"
          workspaceLabel="Mock Workspace"
          defaultEditorId="animation-editor"
        />
      );
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='animation-editor']")).not.toBeNull();

    await act(async () => {
      registryState.missingEditorIds = new Set(["animation-editor"]);
      root.render(
        <PanelLayout
          workspaceId="workspace"
          workspaceLabel="Mock Workspace"
          defaultEditorId="animation-editor"
        />
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Editor unavailable");
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

    const selector = container.querySelector(
      "select"
    ) as HTMLSelectElement | null;
    expect(selector).not.toBeNull();

    await act(async () => {
      if (!selector) return;
      selector.value = "mock-editor";
      selector.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='mock-editor']")).not.toBeNull();

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
    const workbench = readWorkbench(studioStore, "workspace");
    expect(workbench?.layouts).toHaveLength(2);
    expect(workbench?.defaultLayoutId).toBe(workbench?.layouts?.[1]?.id);
    const defaultLayout = readLayout(
      studioStore,
      "workspace",
      "main:workspace:default"
    );
    expect(defaultLayout?.label).toBe("Mock Workspace | Default");
    const nextLayoutId = workbench?.layouts?.[1]?.id;
    expect(nextLayoutId).toBeTruthy();

    await vi.waitFor(() => {
      expect(readLayout(studioStore, "workspace", nextLayoutId)).not.toBeNull();
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
    const defaultLayout = readLayout(
      studioStore,
      "workspace",
      "main:workspace:default"
    );
    expect(defaultLayout?.label).toBe("Auditory Work");

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

    const workbench = readWorkbench(studioStore, "workspace");
    const layoutIds = workbench?.layouts?.map((layout: { id: string }) => layout.id);
    expect(layoutIds).toHaveLength(2);
    expect(layoutIds?.[0]).toMatch(/^main:workspace:/);
    expect(layoutIds?.[0]).not.toBe("main:workspace:default");
    expect(layoutIds?.[1]).toBe("main:workspace:default");

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
    const workbenchBeforeCancel = readWorkbench(studioStore, "workspace");
    expect(workbenchBeforeCancel?.layouts).toHaveLength(2);

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
    expect(readWorkbench(studioStore, "workspace")?.layouts).toHaveLength(2);

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

    const workbenchAfterClose = readWorkbench(studioStore, "workspace");
    expect(
      workbenchAfterClose?.layouts?.map((layout: { id: string }) => layout.id)
    ).toEqual(["main:workspace:default"]);
    expect(workbenchAfterClose?.defaultLayoutId).toBe("main:workspace:default");

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

    studioStore.files.set(
      "studio/studio.yaml",
      `
resourceType: studio_document
schemaVersion: 1
id: barr-e-studio
windows:
  - id: main
    label: Main Window
    windowRole: main
    defaultWorkbenchId: workspace
    workbenches:
      - id: workspace
        label: workspace
        defaultLayoutId: main:workspace:default
        layouts:
          - id: main:workspace:default
            label: Mock Workspace | Default
            dock:
              nodeType: panel
              panelId: leaf-1
              editorId: animation-editor
`
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
      readLayout(studioStore, "workspace", "main:workspace:default")?.dock?.editorId
    ).toBe("animation-editor");

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

    await vi.waitFor(() => {
      expect(
        container.querySelector("[data-testid='animation-editor']")
      ).not.toBeNull();
    });

    act(() => {
      root.unmount();
    });
  });
});
