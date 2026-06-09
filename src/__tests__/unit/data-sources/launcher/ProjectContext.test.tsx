import React, { useEffect } from "react";
import { act } from "react";
import { beforeAll, describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";

import {
  LauncherServiceProvider,
  Project,
  createMockLauncherService,
} from "../../../../renderer/data-sources/launcher";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function ProjectPathProbe({
  onPath,
}: {
  onPath: (path: string) => void;
}) {
  const { projectPath } = Project.Context.use();
  useEffect(() => {
    onPath(projectPath);
  }, [onPath, projectPath]);
  return null;
}

describe("ProjectContext", () => {
  it("ignores stale initial selection hydration after a newer project change arrives", async () => {
    const initialState = deferred<{
      currentProjectPath: string;
      bootstrapIssue: null;
    }>();
    const service = createMockLauncherService({
      projectPath: "",
      getProjectSelectionState: async () => initialState.promise,
    });

    const seenPaths: string[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <LauncherServiceProvider service={service}>
            <Project.Context.Provider>
              <ProjectPathProbe onPath={(path) => seenPaths.push(path)} />
            </Project.Context.Provider>
          </LauncherServiceProvider>
        );
      });

      await act(async () => {
        service.setProjectPath("/repo/robots/tim-e/tim-e.project.yaml");
      });

      await act(async () => {
        initialState.resolve({
          currentProjectPath: "/repo/robots/barr-e/barr-e.project.yaml",
          bootstrapIssue: null,
        });
        await initialState.promise;
      });

      expect(seenPaths).toContain("/repo/robots/tim-e/tim-e.project.yaml");
      expect(seenPaths.at(-1)).toBe("/repo/robots/tim-e/tim-e.project.yaml");
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });
});
