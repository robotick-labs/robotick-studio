import { BrowserRouter, HashRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectRouterComponent } from "../App";

describe("router selection", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("uses HashRouter when running as standalone desktop", () => {
    const RouterComponent = selectRouterComponent({ isStandaloneApp: true });
    expect(RouterComponent).toBe(HashRouter);
  });

  it("defaults to BrowserRouter for hosted web environments", () => {
    const RouterComponent = selectRouterComponent({
      isStandaloneApp: false,
      locationProtocol: "https:",
      isElectronRuntime: false,
    });
    expect(RouterComponent).toBe(BrowserRouter);
  });

  it("falls back to HashRouter when the renderer is loaded from file protocol", () => {
    const RouterComponent = selectRouterComponent({
      isStandaloneApp: false,
      locationProtocol: "file:",
      isElectronRuntime: false,
    });
    expect(RouterComponent).toBe(HashRouter);
  });

  it("treats process.versions.electron detection as a signal to use HashRouter", () => {
    const RouterComponent = selectRouterComponent({
      isStandaloneApp: false,
      locationProtocol: "https:",
      isElectronRuntime: true,
    });
    expect(RouterComponent).toBe(HashRouter);
  });
});
