import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTickScopeSmoothing } from "../../../../renderer/components/editors/tick-scope/TickScopePage";

function createModelTick({
  tickSeq,
  cpuPercent,
  memoryBytes,
  workerCpuMs,
}: {
  tickSeq: number;
  cpuPercent: number;
  memoryBytes: number;
  workerCpuMs: number;
}) {
  return {
    id: "model",
    name: "Model",
    modelPath: "models/model.yaml",
    telemetryBaseUrl: "http://127.0.0.1:7001",
    tickSeq,
    periodMs: 100,
    slackMs: 20,
    status: "healthy",
    processMemoryUsed: memoryBytes,
    workloadsMemoryUsed: memoryBytes / 2,
    runtimeMetrics: {
      source: "launcher",
      sampledAt: null,
      sampleWindowMs: null,
      rootPid: 1,
      processCount: 1,
      cpuPercent,
      rssBytes: memoryBytes,
      engineProcess: {
        pid: 1,
        parentPid: null,
        name: "engine",
        role: "engine",
        cpuPercent,
        rssBytes: memoryBytes,
        children: 0,
        kind: "engine",
      },
      processTree: [
        {
          pid: 1,
          parentPid: null,
          name: "engine",
          role: "engine",
          cpuPercent,
          rssBytes: memoryBytes,
          children: 0,
          kind: "engine",
        },
      ],
    },
    threads: [
      {
        name: "process worker threads",
        role: "observed",
        spans: [],
        workerThreads: [
          {
            threadId: 10,
            name: "worker",
            cpuMs: workerCpuMs,
          },
        ],
        workerThreadCpuTotalMs: workerCpuMs,
      },
    ],
    rawSnapshot: {},
  } as const;
}

describe("applyTickScopeSmoothing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("smooths runtime, process-tree, memory, and worker-thread metrics", () => {
    const nowSpy = vi.spyOn(performance, "now");
    const history = new Map();

    nowSpy.mockReturnValue(0);
    applyTickScopeSmoothing(
      createModelTick({
        tickSeq: 1,
        cpuPercent: 0,
        memoryBytes: 100,
        workerCpuMs: 0,
      }),
      5,
      history,
    );

    nowSpy.mockReturnValue(2500);
    applyTickScopeSmoothing(
      createModelTick({
        tickSeq: 2,
        cpuPercent: 100,
        memoryBytes: 300,
        workerCpuMs: 10,
      }),
      5,
      history,
    );

    nowSpy.mockReturnValue(5000);
    const smoothed = applyTickScopeSmoothing(
      createModelTick({
        tickSeq: 3,
        cpuPercent: 100,
        memoryBytes: 300,
        workerCpuMs: 10,
      }),
      5,
      history,
    );

    expect(smoothed.runtimeMetrics.cpuPercent).toBeCloseTo(50);
    expect(smoothed.runtimeMetrics.rssBytes).toBeCloseTo(200);
    expect(smoothed.runtimeMetrics.engineProcess?.cpuPercent).toBeCloseTo(50);
    expect(smoothed.runtimeMetrics.processTree[0].cpuPercent).toBeCloseTo(50);
    expect(smoothed.processMemoryUsed).toBeCloseTo(200);
    expect(smoothed.workloadsMemoryUsed).toBeCloseTo(100);
    expect(smoothed.threads[0].workerThreadCpuTotalMs).toBeCloseTo(5);
    expect(smoothed.threads[0].workerThreads?.[0].cpuMs).toBeCloseTo(5);
  });
});
