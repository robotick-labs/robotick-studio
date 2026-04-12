import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bootstrapElectron,
  type BrowserWindowConstructor,
  type ElectronApp,
} from "../main/bootstrap";

vi.mock("../main/launcher-manager", () => ({
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

function createBrowserWindow(): BrowserWindowConstructor {
  const windows: BrowserWindowMock[] = [];
  return Object.assign(
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
    }
  ) as BrowserWindowConstructor;
}

function createIpcMainMock() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = {
    on: vi.fn(),
    handle: vi.fn(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      }
    ),
  };
  return {
    ipcMain: ipcMain as unknown as import("electron").IpcMain,
    handlers,
  };
}

describe("studio process stats IPC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aggregates CPU and memory across app metrics", async () => {
    const { ipcMain, handlers } = createIpcMainMock();
    const app: ElectronApp = {
      commandLine: {
        appendSwitch: vi.fn(),
      },
      getAppMetrics: vi.fn(() => [
        {
          cpu: { percentCPU: 12.5 },
          memory: { workingSetSize: 1024 * 200 },
        },
        {
          cpu: { percentCPU: 7.25 },
          memory: { workingSetSize: 1024 * 300 },
        },
      ]),
      whenReady: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
      quit: vi.fn(),
    };

    await bootstrapElectron({
      app,
      BrowserWindow: createBrowserWindow(),
      ipcMain,
      env: {},
      platform: "linux",
    });

    const handler = handlers.get("robotick-studio-process-stats");
    expect(handler).toBeTypeOf("function");

    const stats = handler?.() as { cpuPercent: number; memoryMb: number };
    expect(stats.cpuPercent).toBe(19.75);
    expect(stats.memoryMb).toBe(500);
  });

  it("falls back to main-process sampling when app metrics are unavailable", async () => {
    const { ipcMain, handlers } = createIpcMainMock();
    const app: ElectronApp = {
      commandLine: {
        appendSwitch: vi.fn(),
      },
      getAppMetrics: vi.fn(() => []),
      whenReady: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
      quit: vi.fn(),
    };

    await bootstrapElectron({
      app,
      BrowserWindow: createBrowserWindow(),
      ipcMain,
      env: {},
      platform: "linux",
    });

    const handler = handlers.get("robotick-studio-process-stats");
    expect(handler).toBeTypeOf("function");

    const stats = handler?.() as { cpuPercent: number; memoryMb: number };
    expect(Number.isFinite(stats.cpuPercent)).toBe(true);
    expect(stats.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(stats.memoryMb)).toBe(true);
    expect(stats.memoryMb).toBeGreaterThan(0);
  });
});
