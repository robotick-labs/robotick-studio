import { beforeEach, describe, expect, it } from "vitest";
import {
  clearFloatingPanels,
  getFloatingPanels,
  spawnFloatingPanel,
  updateFloatingPanel,
} from "../../../../renderer/components/workbenches/floating-panels/floating-panel-store";

describe("floating-panel-store", () => {
  const scope = "test-scope";

  beforeEach(() => {
    clearFloatingPanels(scope);
  });

  it("replaces panel settings when explicitly provided", () => {
    const panelId = spawnFloatingPanel(scope, {
      editorId: "telemetry-tree",
      settings: {
        selectedField: "outputs.alpha",
        expandedPaths: ["alpha.outputs"],
      },
    });

    updateFloatingPanel(scope, panelId, {
      settings: {},
    });

    expect(getFloatingPanels(scope)).toMatchObject([
      {
        id: panelId,
        editorId: "telemetry-tree",
        settings: {},
      },
    ]);
  });
});
