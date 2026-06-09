import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const { launcherState, viewer } = vi.hoisted(() => ({
  launcherState: {
    status: "running",
  },
  viewer: {
    init: vi.fn(async () => 42),
    uninit: vi.fn(async () => undefined),
  },
}));

vi.mock("../../../../../plugins/remote-control/src/studio-host", () => ({
  definePanelPersistence: vi.fn((definition) => definition),
  defineStudioPanel: vi.fn((contribution) => contribution),
  usePanelInstance: vi.fn(() => ({
    workbenchId: "remote-control",
    panelId: "panel-remote-control",
  })),
  usePanelSettings: vi.fn(() => [{}, vi.fn()]),
  viewer,
  Launcher: {
    Context: {
      use: () => ({ status: launcherState.status }),
    },
  },
  Project: {
    Context: {
      use: () => ({ projectPath: "/tmp/barr-e" }),
    },
  },
  ProjectData: {
    use: () => ({
      rcModules: {
        data: [
          {
            type: "viewer/streaming-image",
            config: {
              streams: {
                Chase: "demo-robot-simulator.chase_camera_jpeg.outputs.image",
              },
            },
          },
          {
            type: "overlay/remote-controls",
            config: {},
          },
        ],
        loading: false,
        error: null,
      },
    }),
  },
}));

vi.mock(
  "../../../../../plugins/remote-control/src/components/remote-controls/RemoteControlsPanel",
  () => ({
    default: () => <div data-testid="remote-controls" />,
  }),
);

vi.mock(
  "../../../../../plugins/remote-control/src/components/RcSubtitlesOverlay",
  () => ({
    RcSubtitlesOverlay: () => <div data-testid="subtitles" />,
  }),
);

import { RemoteControlPage } from "../../../../../plugins/remote-control/src/RemoteControlPage";

async function render(root: Root, ui: React.ReactNode) {
  await act(async () => {
    root.render(ui);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("RemoteControlPage", () => {
  afterEach(() => {
    launcherState.status = "running";
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("disposes only its owned viewer instance when launcher status changes", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await render(root, <RemoteControlPage />);

    expect(viewer.init).toHaveBeenCalledTimes(1);

    launcherState.status = "stopped";
    await render(root, <RemoteControlPage />);

    expect(viewer.uninit).toHaveBeenCalledWith(
      42,
      "remote control viewer effect cleanup",
    );
    expect(viewer.uninit).not.toHaveBeenCalledWith(
      undefined,
      expect.any(String),
    );

    await act(async () => {
      root.unmount();
    });
  });
});
