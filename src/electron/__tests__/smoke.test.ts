import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bootstrapElectron,
  type BrowserWindowConstructor,
} from "../main/bootstrap";

type BrowserWindowMock = {
  setMenuBarVisibility: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  loadFile: ReturnType<typeof vi.fn>;
};

const createElectronMocks = () => {
  const windows: BrowserWindowMock[] = [];
  const BrowserWindow = Object.assign(
    vi.fn().mockImplementation(() => {
      const win: BrowserWindowMock = {
        setMenuBarVisibility: vi.fn(),
        loadURL: vi.fn(),
        loadFile: vi.fn(),
      };
      windows.push(win);
      return win;
    }),
    {
      getAllWindows: vi.fn(() => windows),
    },
  );

  const eventHandlers = new Map<string, () => void>();
  const app = {
    commandLine: {
      appendSwitch: vi.fn(),
    },
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn((event: string, handler: () => void) => {
      eventHandlers.set(event, handler);
    }),
    quit: vi.fn(),
  };

  return { app, BrowserWindow, windows, eventHandlers };
};

const bootstrapWithMocks = async (env?: string) => {
  const mocks = createElectronMocks();
  await bootstrapElectron({
    app: mocks.app,
    BrowserWindow: mocks.BrowserWindow as BrowserWindowConstructor,
    env: env ? { ELECTRON_DEV: env } : {},
    platform: "linux",
  });

  return { ...mocks, env };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("electron launch paths", () => {
  it("enables dev tooling and loads the dev server when ELECTRON_DEV=1", async () => {
    const mocks = await bootstrapWithMocks("1");
    const window = mocks.windows[0];

    expect(mocks.app.commandLine.appendSwitch).toHaveBeenCalledWith(
      "remote-debugging-port",
      "9222",
    );
    expect(window.loadURL).toHaveBeenCalledWith("http://localhost:5173");
    expect(window.loadFile).not.toHaveBeenCalled();
  });

  it("loads the built renderer when not in dev mode", async () => {
    const mocks = await bootstrapWithMocks();
    const window = mocks.windows[0];

    expect(window.loadFile).toHaveBeenCalledTimes(1);
    expect(window.loadFile.mock.calls[0][0]).toContain("renderer/index.html");
    expect(window.loadURL).not.toHaveBeenCalled();
  });

  it("recreates a window via the activate handler when all windows are closed", async () => {
    const mocks = await bootstrapWithMocks();
    const activateHandler = mocks.eventHandlers.get("activate");
    expect(activateHandler).toBeDefined();

    mocks.windows.length = 0;
    activateHandler?.();

    expect(mocks.windows.length).toBe(1);
    expect(mocks.BrowserWindow).toHaveBeenCalledTimes(2);
  });

  it("quits the app when all windows close on non-mac platforms", async () => {
    const mocks = await bootstrapWithMocks();
    const handler = mocks.eventHandlers.get("window-all-closed");
    expect(handler).toBeDefined();

    handler?.();

    expect(mocks.app.quit).toHaveBeenCalledTimes(1);
  });
});
