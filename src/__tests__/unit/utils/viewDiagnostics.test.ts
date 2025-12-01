import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLastViewDiagnostics,
  reportViewDiagnostics,
} from "../../../renderer/utils/viewDiagnostics";

describe("view diagnostics reporter", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    (globalThis as typeof globalThis & { window?: Window }).window = {} as Window;
  });

  afterEach(() => {
    vi.useRealTimers();
    infoSpy.mockRestore();
  });

  it("stores the latest view payload on window for runtime inspection", () => {
    reportViewDiagnostics("workspace", { workspaceId: "home" });
    const payload = getLastViewDiagnostics();
    expect(payload).toEqual({
      view: "workspace",
      timestamp: new Date("2025-01-01T00:00:00Z").getTime(),
      data: { workspaceId: "home" },
    });
  });

  it("logs each view transition for developer visibility", () => {
    reportViewDiagnostics("not-found", { pathname: "/bad" });
    expect(infoSpy).toHaveBeenCalledWith("[Robotick] View diagnostics", {
      view: "not-found",
      timestamp: new Date("2025-01-01T00:00:00Z").getTime(),
      data: { pathname: "/bad" },
    });
  });
});
