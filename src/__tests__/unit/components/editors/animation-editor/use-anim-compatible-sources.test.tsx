import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAnimCompatibleSources } from "../../../../../renderer/components/editors/animation-editor/hooks/useAnimCompatibleSources";

describe("useAnimCompatibleSources", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("discovers only workloads whose inputs/outputs expose the anim editor structs", async () => {
    const launcherService = {
      fetchProjectWorkloadsRegistry: vi.fn().mockResolvedValue({
        workloads: [
          {
            type: "AnimCapableWorkload",
            inputs: { type: "AnimInputs" },
            outputs: { type: "AnimOutputs" },
          },
          {
            type: "OtherWorkload",
            inputs: { type: "OtherInputs" },
            outputs: { type: "OtherOutputs" },
          },
        ],
        types: [
          {
            name: "AnimInputs",
            fields: [{ name: "anim_controls", type: "AnimControls" }],
          },
          {
            name: "AnimOutputs",
            fields: [{ name: "anim_state", type: "AnimState" }],
          },
          {
            name: "OtherInputs",
            fields: [{ name: "something_else", type: "float" }],
          },
          {
            name: "OtherOutputs",
            fields: [{ name: "nothing_useful", type: "float" }],
          },
        ],
      }),
    };

    const projectModels = {
      data: [
        {
          modelName: "Barr.e",
          modelPath: "robots/barr-e/models/barr-e-animator.model.yaml",
          telemetryBaseUrl: "http://telemetry",
          data: {
            workloads: [
              { id: "anim-1", name: "animator", type: "AnimCapableWorkload" },
              { id: "other-1", name: "other", type: "OtherWorkload" },
            ],
          },
        },
      ],
    };

    const { result } = renderHook(() =>
      useAnimCompatibleSources({
        launcherService: launcherService as never,
        projectModels: projectModels as never,
        projectPath: "/tmp/project.robotick.yaml",
      })
    );

    await waitFor(() => expect(result.current).toHaveLength(1));

    expect(launcherService.fetchProjectWorkloadsRegistry).toHaveBeenCalledWith(
      "/tmp/project.robotick.yaml",
      "linux"
    );
    expect(result.current).toEqual([
      {
        id: "robots/barr-e/models/barr-e-animator.model.yaml::anim-1",
        label: "Barr.e | animator",
        modelName: "Barr.e",
        modelPath: "robots/barr-e/models/barr-e-animator.model.yaml",
        telemetryBaseUrl: "http://telemetry",
        type: "AnimCapableWorkload",
        workloadName: "animator",
      },
    ]);
  });

  it("returns no sources if the registry lookup fails", async () => {
    const launcherService = {
      fetchProjectWorkloadsRegistry: vi.fn().mockRejectedValue(new Error("boom")),
    };

    const { result } = renderHook(() =>
      useAnimCompatibleSources({
        launcherService: launcherService as never,
        projectModels: { data: [] } as never,
        projectPath: "/tmp/project.robotick.yaml",
      })
    );

    await waitFor(() => expect(launcherService.fetchProjectWorkloadsRegistry).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});
