import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bootstrapElectron,
  type BrowserWindowConstructor,
} from "../../main/bootstrap";

vi.mock("../../main/launcher-manager", () => ({
  ensureLauncherReady: vi.fn().mockResolvedValue(undefined),
  stopManagedLauncher: vi.fn().mockResolvedValue(undefined),
}));

type BrowserWindowMock = {
  setMenuBarVisibility: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  loadFile: ReturnType<typeof vi.fn>;
  minimize: ReturnType<typeof vi.fn>;
  maximize: ReturnType<typeof vi.fn>;
  unmaximize: ReturnType<typeof vi.fn>;
  isMaximized: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  getBounds: ReturnType<typeof vi.fn>;
  webContents: {
    send: ReturnType<typeof vi.fn>;
    setWindowOpenHandler: ReturnType<typeof vi.fn>;
  };
};

const createElectronMocks = () => {
  const windows: BrowserWindowMock[] = [];
  const BrowserWindow = Object.assign(
    vi.fn().mockImplementation(() => {
      const win: BrowserWindowMock = {
        setMenuBarVisibility: vi.fn(),
        loadURL: vi.fn(),
        loadFile: vi.fn(),
        minimize: vi.fn(),
        maximize: vi.fn(),
        unmaximize: vi.fn(),
        isMaximized: vi.fn(() => false),
        close: vi.fn(),
        on: vi.fn(),
        getBounds: vi.fn(() => ({
          x: 0,
          y: 0,
          width: 1400,
          height: 900,
        })),
        webContents: {
          send: vi.fn(),
          setWindowOpenHandler: vi.fn(),
        },
      };
      windows.push(win);
      return win;
    }),
    {
      getAllWindows: vi.fn(() => windows),
      fromWebContents: vi.fn(() => windows[0] ?? null),
    },
  );

  const eventHandlers = new Map<string, (...args: unknown[]) => void>();
  const app = {
    commandLine: {
      appendSwitch: vi.fn(),
    },
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      eventHandlers.set(event, handler);
    }),
    quit: vi.fn(),
  };

  const webContents = {
    setWindowOpenHandler: vi.fn(),
  };

  const Menu = {
    buildFromTemplate: vi.fn(() => ({
      popup: vi.fn(),
    })),
  };

  return { app, BrowserWindow, windows, eventHandlers, webContents, Menu };
};

const bootstrapWithMocks = async (env?: string) => {
  const mocks = createElectronMocks();
  await bootstrapElectron({
    app: mocks.app,
    BrowserWindow: mocks.BrowserWindow as BrowserWindowConstructor,
    Menu: mocks.Menu as unknown as typeof import("electron").Menu,
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

  it("registers a window-open handler for middle-clicked links", async () => {
    const mocks = await bootstrapWithMocks();
    const handler = mocks.eventHandlers.get("web-contents-created");
    handler?.(undefined, mocks.webContents);

    expect(mocks.webContents.setWindowOpenHandler).toHaveBeenCalledTimes(1);
    const openHandler = mocks.webContents.setWindowOpenHandler.mock.calls[0][0];
    expect(typeof openHandler).toBe("function");

    const result = openHandler({});
    expect(result.action).toBe("allow");
    expect(result.overrideBrowserWindowOptions).toEqual(
      expect.objectContaining({
        width: 1400,
        height: 900,
        titleBarStyle: "hidden",
        frame: false,
        autoHideMenuBar: true,
      }),
    );
    expect(
      result.overrideBrowserWindowOptions?.titleBarOverlay
    ).toBeUndefined();
    expect(result.overrideBrowserWindowOptions?.webPreferences).toEqual(
      expect.objectContaining({
        preload: expect.stringContaining("preload/preload.js"),
        contextIsolation: true,
        sandbox: false,
      }),
    );
  });
});
