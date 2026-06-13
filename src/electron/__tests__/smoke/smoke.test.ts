import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bootstrapElectron,
  type BrowserWindowConstructor,
} from "../../main/bootstrap";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";

type BrowserWindowMock = {
  setMenuBarVisibility: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  loadFile: ReturnType<typeof vi.fn>;
  minimize: ReturnType<typeof vi.fn>;
  maximize: ReturnType<typeof vi.fn>;
  unmaximize: ReturnType<typeof vi.fn>;
  isMaximized: ReturnType<typeof vi.fn>;
  isMinimized: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  getBounds: ReturnType<typeof vi.fn>;
  webContents: {
    send: ReturnType<typeof vi.fn>;
    setWindowOpenHandler: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    getURL: ReturnType<typeof vi.fn>;
    capturePage: ReturnType<typeof vi.fn>;
  };
  handlers: Map<string, Array<(...args: unknown[]) => void>>;
  webContentsHandlers: Map<string, Array<(...args: unknown[]) => void>>;
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
        isMinimized: vi.fn(() => false),
        isDestroyed: vi.fn(() => false),
        close: vi.fn(),
        restore: vi.fn(),
        focus: vi.fn(),
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
          on: vi.fn(),
          getURL: vi.fn(() => "http://localhost:5173"),
          capturePage: vi.fn(async () => ({
            toPNG: () => Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          })),
        },
        handlers: new Map<string, Array<(...args: unknown[]) => void>>(),
        webContentsHandlers: new Map<string, Array<(...args: unknown[]) => void>>(),
      };
      win.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        const handlers = win.handlers.get(event) ?? [];
        handlers.push(handler);
        win.handlers.set(event, handlers);
      });
      win.webContents.on.mockImplementation(
        (event: string, handler: (...args: unknown[]) => void) => {
          const handlers = win.webContentsHandlers.get(event) ?? [];
          handlers.push(handler);
          win.webContentsHandlers.set(event, handlers);
        }
      );
      windows.push(win);
      return win;
    }),
    {
      getAllWindows: vi.fn(() => windows),
      fromWebContents: vi.fn(() => windows[0] ?? null),
    },
  );

  const eventHandlers = new Map<string, (...args: unknown[]) => void>();
  const ipcOnHandlers = new Map<string, (...args: unknown[]) => void>();
  const ipcHandleHandlers = new Map<string, (...args: unknown[]) => unknown>();
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
  const ipcMain = {
    on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
      ipcOnHandlers.set(channel, handler);
    }),
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandleHandlers.set(channel, handler);
    }),
  };

  const webContents = {
    setWindowOpenHandler: vi.fn(),
  };

  const Menu = {
    buildFromTemplate: vi.fn(() => ({
      popup: vi.fn(),
    })),
  };

  return {
    app,
    BrowserWindow,
    windows,
    eventHandlers,
    webContents,
    Menu,
    ipcMain,
    ipcOnHandlers,
    ipcHandleHandlers,
  };
};

const bootstrapWithMocks = async (
  env?: string | Record<string, string>
) => {
  const mocks = createElectronMocks();
  const resolvedEnv =
    typeof env === "string"
      ? { ELECTRON_DEV: env }
      : env ?? {};
  await bootstrapElectron({
    app: mocks.app,
    BrowserWindow: mocks.BrowserWindow as BrowserWindowConstructor,
    Menu: mocks.Menu as unknown as typeof import("electron").Menu,
    ipcMain: mocks.ipcMain as unknown as import("electron").IpcMain,
    env: resolvedEnv,
    platform: "linux",
  });

  return { ...mocks, env: resolvedEnv };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
    }),
  );
});

function createWritableProjectPath() {
  return path.join(
    os.tmpdir(),
    `robotick-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    "barr-e.project.yaml"
  );
}

async function getJson(endpoint: string) {
  return new Promise<{ statusCode: number; body: unknown }>((resolve, reject) => {
    http
      .get(endpoint, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          resolve({
            statusCode: response.statusCode ?? 0,
            body: text.length > 0 ? JSON.parse(text) : null,
          });
        });
      })
      .on("error", reject);
  });
}

describe("electron launch paths", () => {
  it("enables dev tooling and loads the dev server when ELECTRON_DEV=1", async () => {
    const mocks = await bootstrapWithMocks("1");
    const window = mocks.windows[0];

    expect(mocks.app.commandLine.appendSwitch).toHaveBeenCalledWith(
      "remote-debugging-port",
      "9222",
    );
    await vi.waitFor(() => {
      expect(window.loadURL).toHaveBeenCalledWith("http://localhost:5173");
    });
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

    await vi.waitFor(() => {
      expect(mocks.app.quit).toHaveBeenCalledTimes(1);
    });
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
        sandbox: true,
      }),
    );
  });

  it("reuses an existing child window when createWindow is called with the same scope", async () => {
    const mocks = await bootstrapWithMocks();
    const handler = mocks.ipcHandleHandlers.get("robotick-window-command");
    expect(handler).toBeDefined();

    const invokeEvent = { sender: {} };
    await handler?.(invokeEvent, {
      command: "createWindow",
      scope: "child-preset-a",
      projectPath: createWritableProjectPath(),
    });
    expect(mocks.BrowserWindow).toHaveBeenCalledTimes(2);

    await handler?.(invokeEvent, {
      command: "createWindow",
      scope: "child-preset-a",
      projectPath: createWritableProjectPath(),
    });
    expect(mocks.BrowserWindow).toHaveBeenCalledTimes(2);
    expect(mocks.windows[1].focus).toHaveBeenCalledTimes(1);
  });

  it("allocates a fresh child scope for new windows when persisted child windows already exist", async () => {
    const projectDir = path.join(
      os.tmpdir(),
      `robotick-studio-child-scope-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    const projectYamlPath = path.join(projectDir, "barr-e.project.yaml");
    fs.mkdirSync(path.join(projectDir, "studio"), { recursive: true });
    fs.writeFileSync(projectYamlPath, "name: Barr-E\n", "utf-8");
    fs.writeFileSync(
      path.join(projectDir, "studio", "studio.yaml"),
      [
        "resourceType: studio_document",
        "schemaVersion: 1",
        "id: barr-e-studio",
        "windows:",
        "  - id: main",
        '    label: "Main Window"',
        "    windowRole: main",
        "    defaultWorkbenchId: home",
        "    workbenches: []",
        "  - id: child-window-1",
        '    label: "Existing Child"',
        "    windowRole: child",
        "    defaultWorkbenchId: new-workbench",
        "    workbenches: []",
      ].join("\n"),
      "utf-8"
    );

    try {
      const mocks = await bootstrapWithMocks();
      const handler = mocks.ipcHandleHandlers.get("robotick-window-command");
      expect(handler).toBeDefined();

      const invokeEvent = { sender: {} };
      await handler?.(invokeEvent, {
        command: "createWindow",
        projectPath: projectYamlPath,
      });

      expect(mocks.BrowserWindow).toHaveBeenCalledTimes(2);
      expect(mocks.BrowserWindow.mock.calls[1]?.[0]).toEqual(
        expect.objectContaining({
          webPreferences: expect.objectContaining({
            additionalArguments: expect.arrayContaining([
              "--robotick-window-scope=child-window-2",
            ]),
          }),
        })
      );
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("reports a bootstrap project lock conflict through project selection state", async () => {
    const projectDir = path.join(
      os.tmpdir(),
      `robotick-studio-locked-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    const lockDir = path.join(projectDir, "studio");
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(
      path.join(lockDir, "studio.lock"),
      JSON.stringify(
        {
          pid: process.ppid,
          instanceName: "studio-parent",
          projectPath: projectDir,
        },
        null,
        2
      ),
      "utf-8"
    );

    try {
      const mocks = await bootstrapWithMocks({
        ROBOTICK_PROJECT_DIR: projectDir,
      });
      const handler = mocks.ipcHandleHandlers.get(
        "robotick-project-selection:get-state"
      );
      expect(handler).toBeDefined();

      const state = await handler?.();
      expect(state).toEqual(
        expect.objectContaining({
          currentProjectPath: "",
          bootstrapIssue: expect.objectContaining({
            type: "locked",
            projectPath: projectDir,
          }),
        })
      );
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("accepts renderer project-selection requests using a project yaml path and locks the containing project", async () => {
    const projectDir = path.join(
      os.tmpdir(),
      `robotick-studio-project-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    const projectYamlPath = path.join(projectDir, "barr-e.project.yaml");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(projectYamlPath, "name: Barr-E\n", "utf-8");

    try {
      const mocks = await bootstrapWithMocks();
      const setHandler = mocks.ipcHandleHandlers.get(
        "robotick-project-selection:set"
      );
      expect(setHandler).toBeDefined();

      const result = await setHandler?.(undefined, {
        projectPath: projectYamlPath,
      });

      expect(result).toEqual(
        expect.objectContaining({
          accepted: true,
          currentProjectPath: projectYamlPath,
          issue: null,
        })
      );
      expect(
        fs.existsSync(path.join(projectDir, "studio", "studio.lock"))
      ).toBe(true);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("bootstraps project selection from a project directory by resolving the project yaml", async () => {
    const projectDir = path.join(
      os.tmpdir(),
      `robotick-studio-bootstrap-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    const projectYamlPath = path.join(projectDir, "alf-e.project.yaml");
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(projectYamlPath, "name: Alf.e\n", "utf-8");

    try {
      const mocks = await bootstrapWithMocks({
        ROBOTICK_PROJECT_DIR: projectDir,
      });
      const handler = mocks.ipcHandleHandlers.get(
        "robotick-project-selection:get-state"
      );
      expect(handler).toBeDefined();

      const state = await handler?.();
      expect(state).toEqual(
        expect.objectContaining({
          currentProjectPath: projectYamlPath,
          bootstrapIssue: null,
        })
      );
      expect(
        fs.existsSync(path.join(projectDir, "studio", "studio.lock"))
      ).toBe(true);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("close command only closes target window and does not quit app", async () => {
    const mocks = await bootstrapWithMocks();
    const handler = mocks.ipcHandleHandlers.get("robotick-window-command");
    expect(handler).toBeDefined();

    const invokeEvent = { sender: {} };
    await handler?.(invokeEvent, { command: "close" });

    expect(mocks.windows[0].close).toHaveBeenCalledTimes(1);
    expect(mocks.app.quit).not.toHaveBeenCalled();
  });

  it("advertises the hub control endpoint only after the primary renderer reports active state", async () => {
    const mocks = await bootstrapWithMocks({
      ROBOTICK_STUDIO_MANAGED_BY_HUB: "1",
      ROBOTICK_HUB_ENDPOINT: "http://127.0.0.1:7099",
      ROBOTICK_STUDIO_INSTANCE_NAME: "studio-test",
    });
    const fetchMock = vi.mocked(fetch);
    const activeResourceHandler = mocks.ipcOnHandlers.get(
      "robotick-studio-runtime:active-resource"
    );

    expect(activeResourceHandler).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();

    activeResourceHandler?.(
      { sender: mocks.windows[0].webContents },
      {
        window_id: "main",
        workbench_id: "telemetry",
      }
    );

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:7099/v1/studio/instances/studio-test/control-endpoint"
    );
  });

  it.each([
    ["dev", "1"],
    ["production", ""],
  ])("serves diagnostics console and screenshot routes in %s launch mode", async (_label, devFlag) => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "robotick-studio-smoke-"));
    const mocks = await bootstrapWithMocks({
      ELECTRON_DEV: devFlag,
      ROBOTICK_STUDIO_MANAGED_BY_HUB: "1",
      ROBOTICK_HUB_ENDPOINT: "http://127.0.0.1:7099",
      ROBOTICK_STUDIO_INSTANCE_NAME: "studio-test",
      ROBOTICK_WORKSPACE_ROOT: workspaceRoot,
    });
    const fetchMock = vi.mocked(fetch);
    const activeResourceHandler = mocks.ipcOnHandlers.get(
      "robotick-studio-runtime:active-resource"
    );
    const consoleHandlers = mocks.windows[0].webContentsHandlers.get("console-message") ?? [];

    expect(activeResourceHandler).toBeDefined();
    expect(consoleHandlers.length).toBeGreaterThan(0);

    consoleHandlers[0](
      undefined,
      "error",
      "Renderer smoke failure",
      42,
      "http://localhost:5173/assets/index.js"
    );
    activeResourceHandler?.(
      { sender: mocks.windows[0].webContents },
      {
        window_id: "main",
        workbench_id: "telemetry",
      }
    );

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:7099/v1/studio/instances/studio-test/control-endpoint",
        expect.objectContaining({ method: "POST" })
      );
    });
    const registrationBody = JSON.parse(
      String(fetchMock.mock.calls.find((call) =>
        String(call[0]).includes("/control-endpoint")
      )?.[1]?.body)
    );
    const controlEndpoint = String(registrationBody.endpoint);

    const consoleResponse = await getJson(`${controlEndpoint}/v1/studio/diagnostics/console`);
    expect(consoleResponse).toMatchObject({
      statusCode: 200,
      body: {
        resource_type: "studio_diagnostics_console",
        records: [
          expect.objectContaining({
            window_id: "main",
            level: "error",
            message: "Renderer smoke failure",
          }),
        ],
      },
    });

    const screenshotResponse = await getJson(
      `${controlEndpoint}/v1/studio/diagnostics/screenshot`
    );
    expect(screenshotResponse.statusCode).toBe(200);
    expect(screenshotResponse.body).toMatchObject({
      resource_type: "studio_diagnostics_screenshot",
      window_id: "main",
      mime_type: "image/png",
    });
    expect(
      fs.existsSync(
        (screenshotResponse.body as { output_path: string }).output_path
      )
    ).toBe(true);

    for (const handler of mocks.windows[0].handlers.get("closed") ?? []) {
      handler();
    }
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("hub-managed primary window close starts app quit immediately", async () => {
    const mocks = createElectronMocks();
    await bootstrapElectron({
      app: mocks.app,
      BrowserWindow: mocks.BrowserWindow as BrowserWindowConstructor,
      Menu: mocks.Menu as unknown as typeof import("electron").Menu,
      ipcMain: mocks.ipcMain as unknown as import("electron").IpcMain,
      env: {
        ROBOTICK_STUDIO_MANAGED_BY_HUB: "1",
        ROBOTICK_HUB_ENDPOINT: "http://127.0.0.1:7099",
      },
      platform: "linux",
    });

    const primaryWindow = mocks.windows[0];
    for (const handler of primaryWindow.handlers.get("close") ?? []) {
      handler();
    }
    for (const handler of primaryWindow.handlers.get("closed") ?? []) {
      handler();
    }

    await vi.waitFor(() => {
      expect(mocks.app.quit).toHaveBeenCalledTimes(1);
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/v1/apps/studio/instances/closing"),
      expect.objectContaining({
        method: "POST",
      }),
    );
  });
});
