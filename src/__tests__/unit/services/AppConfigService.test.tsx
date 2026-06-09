import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockLauncherService } from "../../../renderer/data-sources/launcher/internal/__mocks__/LauncherService";
import {
  AppConfigProvider,
  EditorsConfig,
  WorkbenchesConfig,
  useAppConfig,
} from "../../../renderer/services/AppConfigService";
import { renderWithProviders } from "../../helpers/renderWithProviders";

const PROJECT_PATH = "/repo/robots/barr-e/barr-e.project.yaml";

const initialStudioDocument = `
resourceType: studio_document
schemaVersion: 1
id: barr-e-studio
windows:
  - id: main
    label: Main Window
    windowRole: main
    defaultWorkbenchId: home
    workbenches:
      - id: home
        path: /home
        label: Home
        group: project-select
        defaultEditorId: home
        defaultLayoutId: main:home:default
        layouts:
          - id: main:home:default
            label: Default
            dock:
              nodeType: panel
              panelId: panel-main
              editorId: home
  - id: child-telemetry
    label: Studio Window
    windowRole: child
    defaultWorkbenchId: telemetry
    workbenches:
      - id: telemetry
        path: /telemetry
        label: Telemetry
        group: test
        defaultEditorId: telemetry
        defaultLayoutId: child-telemetry:telemetry:default
        layouts:
          - id: child-telemetry:telemetry:default
            label: Default
            dock:
              nodeType: panel
              panelId: child-panel
              editorId: telemetry
`;

const renamedStudioDocument = initialStudioDocument.replace(
  "label: Studio Window",
  "label: Diagnostics Window"
);

function WindowLabelsProbe() {
  const { windows } = useAppConfig();
  return (
    <div data-testid="window-labels">
      {windows.map((window) => `${window.id}:${window.label}`).join("|")}
    </div>
  );
}

afterEach(() => {
  if (typeof window !== "undefined") {
    delete (window as typeof window & { robotick?: unknown }).robotick;
  }
});

describe("AppConfigService", () => {
  it("loads workbench definitions from YAML", () => {
    expect(WorkbenchesConfig.length).toBeGreaterThan(0);
    const telemetry = WorkbenchesConfig.find((workbench) => workbench.id === "telemetry");
    expect(telemetry).toBeDefined();
    expect(telemetry?.path).toBe("/telemetry");
    expect(telemetry?.group).toBe("test");
    expect(telemetry?.editor).toBeDefined();
  });

  it("loads editor definitions that workbenches can reference", () => {
    expect(EditorsConfig.length).toBeGreaterThan(0);
    const home = EditorsConfig.find((editor) => editor.id === "home");
    expect(home).toBeDefined();
    expect(home?.module).toMatch(/HomePage\.tsx$/);
  });

  it("reloads window labels when studio persistence broadcasts a document change", async () => {
    let currentDocument = initialStudioDocument;
    let documentChangedListener: ((projectPath: string) => void) | null = null;

    (window as typeof window & { robotick?: unknown }).robotick = {
      environment: {
        windowScope: "primary",
        isPrimaryWindow: true,
      },
      studioPersistence: {
        readStudioDocument: vi.fn(async () => currentDocument),
        ensureStudioDocument: vi.fn(async () => undefined),
        writeStudioDocument: vi.fn(async () => undefined),
        onDocumentChanged: vi.fn((callback: (projectPath: string) => void) => {
          documentChangedListener = callback;
          return () => {
            documentChangedListener = null;
          };
        }),
      },
    };

    const { container, unmount } = renderWithProviders(
      <AppConfigProvider>
        <WindowLabelsProbe />
      </AppConfigProvider>,
      {
        launcherService: createMockLauncherService({
          projectPath: PROJECT_PATH,
        }),
        projectPath: PROJECT_PATH,
      }
    );

    await vi.waitFor(() => {
      expect(container.textContent).toContain("child-telemetry:Studio Window");
    });

    currentDocument = renamedStudioDocument;
    documentChangedListener?.(PROJECT_PATH);

    await vi.waitFor(() => {
      expect(container.textContent).toContain(
        "child-telemetry:Diagnostics Window"
      );
    });

    unmount();
  });
});
