import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("projects-api hub-backed discovery", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("prefers robotick-hub project summaries when the hub endpoint is present", async () => {
    vi.stubGlobal("window", {
      robotick: {
        environment: {
          hubEndpoint: "http://127.0.0.1:44493",
        },
      },
    } as Window & typeof globalThis);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.toString()).toBe("http://127.0.0.1:44493/v1/studio/projects");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          projects: [
            {
              name: "barr-e",
              project_dir: "robots/barr-e",
              project_path: "/workspace/robots/barr-e/barr-e.project.yaml",
              display_name: "Barr.e",
              description: "Memory rover.",
            },
            {
              name: "pip-e",
              project_dir: "robots/pip-e",
              project_path: "/workspace/robots/pip-e/pip-e.project.yaml",
              display_name: "Pip.e",
            },
          ],
        }),
        text: async () => "",
      };
    });

    vi.stubGlobal("fetch", fetchMock);

    const projectsApi = await import(
      "../../../../renderer/data-sources/launcher/internal/projects-api"
    );

    await expect(projectsApi.listProjectPaths()).resolves.toEqual([
      "/workspace/robots/barr-e/barr-e.project.yaml",
      "/workspace/robots/pip-e/pip-e.project.yaml",
    ]);

    await expect(projectsApi.fetchProjectSettingsList()).resolves.toEqual([
      {
        path: "/workspace/robots/barr-e/barr-e.project.yaml",
        name: "Barr.e",
        description: "Memory rover.",
      },
      {
        path: "/workspace/robots/pip-e/pip-e.project.yaml",
        name: "Pip.e",
        description: undefined,
      },
    ]);
  });

  it("orders the CLI-selected hub project first for Studio auto-selection", async () => {
    vi.stubGlobal("window", {
      robotick: {
        environment: {
          hubEndpoint: "http://127.0.0.1:44493",
          selectedProject: "pip-e",
        },
      },
    } as Window & typeof globalThis);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          projects: [
            {
              name: "barr-e",
              project_dir: "robots/barr-e",
              project_path: "/workspace/robots/barr-e/barr-e.project.yaml",
              display_name: "Barr.e",
            },
            {
              name: "pip-e",
              project_dir: "robots/pip-e",
              project_path: "/workspace/robots/pip-e/pip-e.project.yaml",
              display_name: "Pip.e",
            },
          ],
        }),
        text: async () => "",
      })),
    );

    const projectsApi = await import(
      "../../../../renderer/data-sources/launcher/internal/projects-api"
    );

    await expect(projectsApi.fetchProjectSettingsList()).resolves.toEqual([
      {
        path: "/workspace/robots/pip-e/pip-e.project.yaml",
        name: "Pip.e",
        description: undefined,
      },
      {
        path: "/workspace/robots/barr-e/barr-e.project.yaml",
        name: "Barr.e",
        description: undefined,
      },
    ]);
  });
});
