import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import http from "http";
import os from "os";
import path from "path";
import fs from "fs";
import { parse } from "yaml";

type ProjectFixture = {
  key: string;
  name: string;
  displayName: string;
  description: string;
  dir: string;
  projectYamlPath: string;
};

type TestEnvironment = {
  rootDir: string;
  windowStateFile: string;
  projects: {
    barr: ProjectFixture;
    tim: ProjectFixture;
  };
  hubEndpoint: string;
  close: () => Promise<void>;
};

test.describe.configure({ mode: "serial" });

test.describe("Studio project selection", () => {
  let environment: TestEnvironment | null = null;
  const apps: ElectronApplication[] = [];

  test.afterEach(async () => {
    while (apps.length > 0) {
      const app = apps.pop();
      if (!app) {
        continue;
      }
      try {
        await app.close();
      } catch {
        // Best-effort close for cleanup.
      }
    }
    if (environment) {
      await environment.close();
      environment = null;
    }
  });

  test("switching projects from the header combo on a non-home workbench does not revert", async () => {
    environment = await createTestEnvironment();
    const { window } = await launchStudio(environment, {
      project: environment.projects.barr,
      instanceName: "studio-e2e-header",
    });

    await expectVisibleProjectPickerValue(
      window,
      environment.projects.barr.projectYamlPath
    );

    await navigateToWorkbench(window, "Project");
    await expect
      .poll(() => window.evaluate(() => window.location.hash))
      .toBe("#/project");

    await selectProject(window, environment.projects.tim.projectYamlPath);

    await expectVisibleProjectPickerValue(
      window,
      environment.projects.tim.projectYamlPath
    );
    await expect
      .poll(() => window.evaluate(() => window.location.hash))
      .toBe("#/project");

    await navigateToWorkbench(window, "Home");
    await expect
      .poll(() => window.evaluate(() => window.location.hash))
      .toBe("#/home");
    await expectVisibleProjectPickerValue(
      window,
      environment.projects.tim.projectYamlPath
    );
  });

  test("restores each project's last visited workbench instead of falling back to home", async () => {
    environment = await createTestEnvironment();
    const { window } = await launchStudio(environment, {
      project: environment.projects.barr,
      instanceName: "studio-e2e-restore",
    });

    await expectVisibleProjectPickerValue(
      window,
      environment.projects.barr.projectYamlPath
    );

    await navigateToWorkbench(window, "Project");
    await expect
      .poll(() => window.evaluate(() => window.location.hash))
      .toBe("#/project");

    await selectProject(window, environment.projects.tim.projectYamlPath);
    await expectVisibleProjectPickerValue(
      window,
      environment.projects.tim.projectYamlPath
    );
    await expect
      .poll(() => window.evaluate(() => window.location.hash))
      .toBe("#/project");
    await expect(window.getByRole("button", { name: /Save/ })).toBeVisible();

    await selectProject(window, environment.projects.barr.projectYamlPath);
    await expectVisibleProjectPickerValue(
      window,
      environment.projects.barr.projectYamlPath
    );
    await expect
      .poll(() => window.evaluate(() => window.location.hash))
      .toBe("#/project");
  });

  test("launching a second Studio for the same project shows the lock conflict dialog", async () => {
    environment = await createTestEnvironment();
    const first = await launchStudio(environment, {
      project: environment.projects.barr,
      instanceName: "studio-e2e-lock-owner",
    });
    await expectVisibleProjectPickerValue(
      first.window,
      environment.projects.barr.projectYamlPath
    );

    const second = await launchStudio(environment, {
      project: environment.projects.barr,
      instanceName: "studio-e2e-lock-blocked",
    });

    const conflictDialog = second.window.getByRole("dialog");
    await expect(conflictDialog).toBeVisible();
    await expect(conflictDialog).toContainText("already open in Studio instance");
    await expect(conflictDialog).toContainText("studio-e2e-lock-owner");
  });

  test("renaming a child window persists across refresh", async () => {
    environment = await createTestEnvironment();
    const { app, window } = await launchStudio(environment, {
      project: environment.projects.barr,
      instanceName: "studio-e2e-child-rename",
    });

    const childWindow = await openChildWindow(app, window);
    const renameTrigger = childWindow.getByLabel("Rename child window");
    await expect(renameTrigger).toContainText("Studio Window");
    await expect
      .poll(() => childWindow.evaluate(() => window.location.hash))
      .toBe("#/home");

    await renameTrigger.click();
    const renameInput = childWindow.getByLabel("Rename child window");
    await expect(renameInput).toBeVisible();
    await renameInput.fill("Diagnostics Window");
    await renameInput.press("Enter");

    await expect(renameTrigger).toContainText("Diagnostics Window");
    await expect
      .poll(() => readChildWindowLabel(environment!.projects.barr.dir))
      .toBe("Diagnostics Window");

    await childWindow.reload();
    await childWindow.waitForLoadState("domcontentloaded");
    await expect(childWindow.getByLabel("Rename child window")).toContainText(
      "Diagnostics Window"
    );
  });

  async function launchStudio(
    testEnvironment: TestEnvironment,
    options: {
      project: ProjectFixture;
      instanceName: string;
    }
  ): Promise<{ app: ElectronApplication; window: Page }> {
    const launchEnv: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      ),
    };
    delete launchEnv.ELECTRON_RUN_AS_NODE;
    const app = await electron.launch({
      args: ["."],
      cwd: path.resolve(__dirname, "..", ".."),
      env: {
        ...launchEnv,
        ROBOTICK_HUB_ENDPOINT: testEnvironment.hubEndpoint,
        ROBOTICK_WORKSPACE_ROOT: testEnvironment.rootDir,
        ROBOTICK_PROJECT_DIR: options.project.projectYamlPath,
        ROBOTICK_STUDIO_SELECTED_PROJECT: options.project.key,
        ROBOTICK_STUDIO_INSTANCE_NAME: options.instanceName,
        ROBOTICK_WINDOW_STATE_FILE: testEnvironment.windowStateFile,
      },
    });
    apps.push(app);
    const window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await expect(window.getByRole("heading", { name: "Welcome to Robotick Studio" })).toBeVisible();
    return { app, window };
  }
});

async function openChildWindow(
  app: ElectronApplication,
  window: Page
): Promise<Page> {
  const childWindowPromise = app.waitForEvent("window");
  await window.getByLabel("Select child window").click();
  await window.getByRole("button", { name: "New Child Window" }).click();
  const childWindow = await childWindowPromise;
  await childWindow.waitForLoadState("domcontentloaded");
  await expect(childWindow.getByLabel("Rename child window")).toBeVisible();
  return childWindow;
}

async function navigateToWorkbench(window: Page, label: string): Promise<void> {
  const directLink = window.getByRole("link", { name: new RegExp(`^${escapeRegExp(label)}$`, "i") }).first();
  if (await directLink.isVisible().catch(() => false)) {
    await directLink.click();
    return;
  }

  const leftMenuButton = window.getByRole("button", {
    name: "Open project navigation menu",
  });
  if (await leftMenuButton.isVisible().catch(() => false)) {
    await leftMenuButton.click();
    const menuLink = window
      .getByRole("menu")
      .getByRole("link", { name: new RegExp(`^${escapeRegExp(label)}$`, "i") })
      .first();
    if (await menuLink.isVisible().catch(() => false)) {
      await menuLink.click();
      return;
    }
  }

  const rightMenuButton = window.getByRole("button", {
    name: "Open workbench tools menu",
  });
  if (await rightMenuButton.isVisible().catch(() => false)) {
    await rightMenuButton.click();
    const menuLink = window
      .getByRole("menu")
      .getByRole("link", { name: new RegExp(`^${escapeRegExp(label)}$`, "i") })
      .first();
    if (await menuLink.isVisible().catch(() => false)) {
      await menuLink.click();
      return;
    }
  }

  throw new Error(`Could not find workbench navigation link for "${label}"`);
}

async function selectProject(window: Page, projectPath: string): Promise<void> {
  const directPicker = window.getByLabel("Select project").first();
  if (await directPicker.isVisible().catch(() => false)) {
    await directPicker.selectOption(projectPath);
    return;
  }

  const menuButton = window.getByRole("button", {
    name: "Open project navigation menu",
  });
  if (await menuButton.isVisible().catch(() => false)) {
    await menuButton.click();
    const menu = window.getByRole("menu").first();
    const menuPicker = menu.getByLabel("Select project").first();
    await expect(menuPicker).toBeVisible();
    await menuPicker.selectOption(projectPath);
    return;
  }

  throw new Error(`Could not find a visible project picker for "${projectPath}"`);
}

async function expectVisibleProjectPickerValue(
  window: Page,
  projectPath: string
): Promise<void> {
  const directPicker = window.getByLabel("Select project").first();
  if (await directPicker.isVisible().catch(() => false)) {
    await expect(directPicker).toHaveValue(projectPath);
    return;
  }

  const menuButton = window.getByRole("button", {
    name: "Open project navigation menu",
  });
  if (await menuButton.isVisible().catch(() => false)) {
    await menuButton.click();
    const menuPicker = window.getByRole("menu").first().getByLabel("Select project").first();
    await expect(menuPicker).toHaveValue(projectPath);
    return;
  }

  throw new Error(`Could not find a visible project picker for assertion "${projectPath}"`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readChildWindowLabel(projectDir: string): string | null {
  const studioDocumentPath = path.join(projectDir, "studio", "studio.yaml");
  const parsed = parse(fs.readFileSync(studioDocumentPath, "utf-8")) as {
    windows?: Array<{
      id?: string;
      windowRole?: string;
      label?: string;
    }>;
  };
  const childWindow = parsed.windows?.find((entry) => entry.windowRole === "child");
  return typeof childWindow?.label === "string" ? childWindow.label : null;
}

async function createTestEnvironment(): Promise<TestEnvironment> {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "robotick-studio-e2e-"));
  const windowStateFile = path.join(rootDir, ".studio", "window-state.json");
  fs.mkdirSync(path.dirname(windowStateFile), { recursive: true });
  fs.writeFileSync(
    windowStateFile,
    JSON.stringify(
      {
        version: 2,
        windows: {
          primary: {
            width: 1700,
            height: 1000,
            x: 0,
            y: 0,
          },
        },
      },
      null,
      2
    ),
    "utf-8"
  );
  const barr = createProjectFixture(rootDir, {
    key: "barr-e",
    displayName: "Barr.E",
    description: "Barr-E project",
  });
  const tim = createProjectFixture(rootDir, {
    key: "tim-e",
    displayName: "Tim.E",
    description: "Tim-E project",
  });

  const server = http.createServer((request, response) => {
    if (!request.url) {
      response.writeHead(404).end();
      return;
    }
    const url = new URL(request.url, "http://127.0.0.1");

    if (url.pathname === "/v1/studio/projects") {
      writeJson(response, {
        projects: [toHubProjectSummary(barr), toHubProjectSummary(tim)],
      });
      return;
    }

    if (url.pathname === "/v1/launcher/status") {
      writeJson(response, {
        resource_type: "robotick_launcher_status",
        groups: [],
        sessions: [],
      });
      return;
    }

    if (url.pathname === "/query/get-project-settings") {
      const projectPath = url.searchParams.get("project_path") || "";
      if (projectPath === barr.projectYamlPath) {
        writeJson(response, {
          name: barr.displayName,
          description: barr.description,
        });
        return;
      }
      if (projectPath === tim.projectYamlPath) {
        writeJson(response, {
          name: tim.displayName,
          description: tim.description,
        });
        return;
      }
      response.writeHead(404).end();
      return;
    }

    response.writeHead(404).end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected mock hub server to bind to a TCP address.");
  }

  return {
    rootDir,
    windowStateFile,
    projects: {
      barr,
      tim,
    },
    hubEndpoint: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      fs.rmSync(rootDir, { recursive: true, force: true });
    },
  };
}

function createProjectFixture(
  rootDir: string,
  options: {
    key: string;
    displayName: string;
    description: string;
  }
): ProjectFixture {
  const dir = path.join(rootDir, "robots", options.key);
  fs.mkdirSync(dir, { recursive: true });
  const projectYamlPath = path.join(dir, `${options.key}.project.yaml`);
  fs.writeFileSync(
    projectYamlPath,
    [`name: ${options.displayName}`, `description: ${options.description}`].join("\n"),
    "utf-8"
  );
  return {
    key: options.key,
    name: options.key,
    displayName: options.displayName,
    description: options.description,
    dir,
    projectYamlPath,
  };
}

function toHubProjectSummary(project: ProjectFixture) {
  return {
    name: project.key,
    project_dir: path.join("robots", project.key),
    project_path: project.projectYamlPath,
    display_name: project.displayName,
    description: project.description,
  };
}

function writeJson(
  response: http.ServerResponse,
  payload: Record<string, unknown>
) {
  response.writeHead(200, {
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(payload));
}
