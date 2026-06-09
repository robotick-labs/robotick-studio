import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock(
  "../../../../renderer/components/editors/telemetry/view/TelemetryApp",
  () => ({
    TelemetryApp: ({
      modelSortKey,
      onModelStateChange,
    }: {
      modelSortKey: string;
      onModelStateChange?: (
        modelId: string,
        updater: Record<string, unknown>,
      ) => void;
    }) => (
      <div data-testid="telemetry-app" data-model-sort-key={modelSortKey}>
        <button
          type="button"
          data-testid="expand-model"
          onClick={() =>
            onModelStateChange?.("barr_e_expression_model_F5C33C27", {
              isExpanded: true,
            })
          }
        />
        <button
          type="button"
          data-testid="collapse-model"
          onClick={() =>
            onModelStateChange?.("barr_e_expression_model_F5C33C27", {
              isExpanded: false,
            })
          }
        />
      </div>
    ),
  }),
);

import TelemetryPage from "../../../../renderer/components/editors/telemetry/TelemetryPage";
import { PanelInstanceProvider } from "../../../../renderer/components/workbenches/PanelInstanceContext";

function PanelHost({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = React.useState<Record<string, unknown>>({});

  return (
    <>
      <PanelInstanceProvider
        panelId="panel-a"
        workbenchId="workbench"
        settings={settings}
        setSettings={setSettings}
        updateSettings={(partial) =>
          setSettings((current) => ({ ...current, ...partial }))
        }
      >
        {children}
      </PanelInstanceProvider>
      <div data-testid="panel-settings">{JSON.stringify(settings)}</div>
    </>
  );
}

function render(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("TelemetryPage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows the panel-level model sort control beside the title and persists it through panel settings", () => {
    const tree = render(
      <PanelHost>
        <TelemetryPage />
      </PanelHost>
    );

    expect(tree.container.textContent).toContain("Workload Telemetry");
    expect(tree.container.textContent).toContain("Sort models by:");

    const sortSelect = tree.container.querySelector(
      "#telemetry-model-sort",
    ) as HTMLSelectElement | null;
    expect(sortSelect).not.toBeNull();
    expect(sortSelect?.value).toBe("telemetry_port");
    expect(Array.from(sortSelect?.options ?? []).map((option) => option.text)).toEqual([
      "Telemetry Port",
      "Model Name",
      "Model Path",
      "Memory - Process",
      "Memory - Workloads",
    ]);

    const telemetryApp = tree.container.querySelector(
      "[data-testid='telemetry-app']",
    );
    expect(telemetryApp?.getAttribute("data-model-sort-key")).toBe(
      "telemetry_port",
    );

    act(() => {
      if (sortSelect) {
        sortSelect.value = "model_name";
        sortSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    expect(
      tree.container
        .querySelector("[data-testid='telemetry-app']")
        ?.getAttribute("data-model-sort-key"),
    ).toBe("model_name");
    expect(
      tree.container.querySelector("[data-testid='panel-settings']")?.textContent
    ).toContain('"modelSortKey":"model_name"');

    tree.unmount();
  });

  it("persists telemetry model state by canonical model id and omits default collapsed entries", () => {
    const tree = render(
      <PanelHost>
        <TelemetryPage />
      </PanelHost>
    );

    act(() => {
      tree.container
        .querySelector("[data-testid='expand-model']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      tree.container.querySelector("[data-testid='panel-settings']")?.textContent
    ).toContain(
      '"models":[{"id":"barr_e_expression_model_F5C33C27","isExpanded":true}]'
    );

    act(() => {
      tree.container
        .querySelector("[data-testid='collapse-model']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      tree.container.querySelector("[data-testid='panel-settings']")?.textContent
    ).toContain('"models":[]');

    tree.unmount();
  });
});
