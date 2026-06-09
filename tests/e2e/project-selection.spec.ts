import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import http from "http";
import os from "os";
import path from "path";
import fs from "fs";

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

  test("switching projects from Home persists when navigating to another workbench", async () => {
    environment = await createTestEnvironment();
    const { window } = await launchStudio(environment, {
      project: environment.projects.barr,
      instanceName: "studio-e2e-home",
    });

    const projectPicker = window.getByLabel("Select project");
    await expect(projectPicker).toHaveValue(environment.projects.barr.projectYamlPath);

    const timCard = window
      .locator("[data-project]")
      .filter({ has: window.getByRole("heading", { name: "Tim.E" }) });
    await timCard.click();

    await expect(projectPicker).toHaveValue(environment.projects.tim.projectYamlPath);

    await window.getByRole("link", { name: "Help" }).click();
    await expect(window.getByRole("heading", { name: "Robotick Studio Help Center" })).toBeVisible();
    await expect(projectPicker).toHaveValue(environment.projects.tim.projectYamlPath);
  });

  test("switching projects from the header combo on a non-home workbench does not revert", async () => {
    environment = await createTestEnvironment();
    const { window } = await launchStudio(environment, {
      project: environment.projects.barr,
      instanceName: "studio-e2e-header",
    });

    const projectPicker = window.getByLabel("Select project");
    await expect(projectPicker).toHaveValue(environment.projects.barr.projectYamlPath);

    await window.getByRole("link", { name: "Help" }).click();
    await expect(window.getByRole("heading", { name: "Robotick Studio Help Center" })).toBeVisible();

    await projectPicker.selectOption(environment.projects.tim.projectYamlPath);

    await expect(projectPicker).toHaveValue(environment.projects.tim.projectYamlPath);
    await expect(window.getByRole("heading", { name: "Welcome to Robotick Studio" })).toBeVisible();

    await window.getByRole("link", { name: "Help" }).click();
    await expect(window.getByRole("heading", { name: "Robotick Studio Help Center" })).toBeVisible();
    await expect(projectPicker).toHaveValue(environment.projects.tim.projectYamlPath);
  });

  test("restores each project's last visited workbench and active layout tab instead of falling back to home", async () => {
    environment = await createTestEnvironment();
    const { window } = await launchStudio(environment, {
      project: environment.projects.barr,
      instanceName: "studio-e2e-restore",
    });

    const projectPicker = window.getByLabel("Select project");
    await expect(projectPicker).toHaveValue(environment.projects.barr.projectYamlPath);

    await window.getByRole("link", { name: "Project" }).click();
    await expect
      .poll(() => window.evaluate(() => window.location.hash))
      .toBe("#/project");

    await window.getByLabel("Create layout tab").click();
    const layoutTabs = window.getByLabel("Workbench layout tabs");
    const newLayoutTab = layoutTabs
      .locator('[role="button"]')
      .filter({ hasText: "Project | New Layout 2" })
      .first();
    await expect(newLayoutTab).toHaveAttribute("aria-pressed", "true");
    await newLayoutTab.dblclick();

    const renamedTabInput = window.getByLabel("Rename layout tab");
    await expect(renamedTabInput).toBeVisible();
    await renamedTabInput.fill("Barr Custom Layout");
    await renamedTabInput.press("Enter");

    const barrCustomTab = layoutTabs
      .locator('[role="button"]')
      .filter({ hasText: "Barr Custom Layout" })
      .first();
    await expect(barrCustomTab).toHaveAttribute("aria-pressed", "true");

    await projectPicker.selectOption(environment.projects.tim.projectYamlPath);
    await expect(projectPicker).toHaveValue(environment.projects.tim.projectYamlPath);
    await expect
      .poll(() => window.evaluate(() => window.location.hash))
      .toBe("#/home");
    await expect(window.getByRole("heading", { name: "Welcome to Robotick Studio" })).toBeVisible();

    await projectPicker.selectOption(environment.projects.barr.projectYamlPath);
    await expect(projectPicker).toHaveValue(environment.projects.barr.projectYamlPath);
    await expect
      .poll(() => window.evaluate(() => window.location.hash))
      .toBe("#/project");
    await expect(barrCustomTab).toHaveAttribute("aria-pressed", "true");
  });

  test("launching a second Studio for the same project shows the lock conflict dialog", async () => {
    environment = await createTestEnvironment();
    const first = await launchStudio(environment, {
      project: environment.projects.barr,
      instanceName: "studio-e2e-lock-owner",
    });
    await expect(first.window.getByLabel("Select project")).toHaveValue(
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

    if (url.pathname === "/launcher/status") {
      writeJson(response, {
        status: "stopped",
        profile: null,
        models: {},
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
