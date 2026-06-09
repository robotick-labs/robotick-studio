import { afterEach, describe, expect, it, vi } from "vitest";

const { createInstance, legacyInit, legacyUninit, unmount } = vi.hoisted(() => {
  const unmount = vi.fn();
  return {
    createInstance: vi.fn(async () => ({ unmount })),
    legacyInit: vi.fn(),
    legacyUninit: vi.fn(),
    unmount,
  };
});

vi.mock(
  "../../../../renderer/components/viewer/streaming-image/viewer-streaming-image",
  () => ({
    default: {
      createInstance,
      init: legacyInit,
      uninit: legacyUninit,
    },
  }),
);

import viewer from "../../../../renderer/components/viewer/viewer";

describe("viewer manager", () => {
  afterEach(async () => {
    await viewer.uninit();
    vi.clearAllMocks();
  });

  it("uses module-created runtimes and unmounts only the requested instance", async () => {
    const firstId = await viewer.init({
      viewerType: "streaming-image",
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
    });
    const secondId = await viewer.init({
      viewerType: "streaming-image",
      camera: { fov: 60, near: 0.1, far: 100 },
      models: [],
    });

    expect(firstId).toEqual(expect.any(Number));
    expect(secondId).toEqual(expect.any(Number));
    expect(firstId).not.toBe(secondId);
    expect(createInstance).toHaveBeenCalledTimes(2);
    expect(legacyInit).not.toHaveBeenCalled();

    await viewer.uninit(firstId ?? undefined, "test cleanup");

    expect(unmount).toHaveBeenCalledTimes(1);

    await viewer.uninit(secondId ?? undefined, "test cleanup");

    expect(unmount).toHaveBeenCalledTimes(2);
    expect(legacyUninit).not.toHaveBeenCalled();
  });
});
