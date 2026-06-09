import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { renderMock, unmountMock, createRootMock } = vi.hoisted(() => {
  const renderMock = vi.fn();
  const unmountMock = vi.fn();
  const createRootMock = vi.fn(() => ({
    render: renderMock,
    unmount: unmountMock,
  }));
  return { renderMock, unmountMock, createRootMock };
});

vi.mock("react-dom/client", () => ({
  createRoot: createRootMock,
}));

import { initPropertyPanel } from "../../../../../renderer/components/editors/models/view/properties/InitPropertyPanel";

describe("InitPropertyPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    renderMock.mockClear();
    unmountMock.mockClear();
    createRootMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("defers nested root unmount until after the current render turn", () => {
    const host = document.createElement("div");
    const store = {} as never;
    const panel = initPropertyPanel(host, store, "scope", "/tmp/project.yaml");

    expect(createRootMock).toHaveBeenCalledWith(host);
    expect(renderMock).toHaveBeenCalledTimes(1);

    panel.dispose?.();

    expect(unmountMock).not.toHaveBeenCalled();

    vi.runAllTimers();

    expect(unmountMock).toHaveBeenCalledTimes(1);
  });

  it("ignores repeated dispose calls", () => {
    const host = document.createElement("div");
    const store = {} as never;
    const panel = initPropertyPanel(host, store, "scope", "/tmp/project.yaml");

    panel.dispose?.();
    panel.dispose?.();

    vi.runAllTimers();

    expect(unmountMock).toHaveBeenCalledTimes(1);
  });

  it("reuses an existing root when the panel is reinitialized before deferred unmount runs", () => {
    const host = document.createElement("div");
    const store = {} as never;
    const firstPanel = initPropertyPanel(host, store, "scope", "/tmp/project.yaml");

    firstPanel.dispose?.();
    const secondPanel = initPropertyPanel(host, store, "scope", "/tmp/project.yaml");

    expect(createRootMock).toHaveBeenCalledTimes(1);
    expect(renderMock).toHaveBeenCalledTimes(2);

    vi.runAllTimers();

    expect(unmountMock).not.toHaveBeenCalled();

    secondPanel.dispose?.();
    vi.runAllTimers();

    expect(unmountMock).toHaveBeenCalledTimes(1);
  });
});
