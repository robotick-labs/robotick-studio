import { describe, expect, it } from "vitest";

import { resolveViewerAssetUrl } from "../../../../renderer/components/viewer/asset-url-resolver";

describe("resolveViewerAssetUrl", () => {
  it("maps project-relative paths to launcher project-assets URLs", () => {
    const url = resolveViewerAssetUrl(
      "assets/barr-e-model.glb",
      "/tmp/robots/barr-e/barr-e.project.yaml"
    );

    expect(url).toContain("http://localhost:7081/query/project-assets/assets/barr-e-model.glb");
    expect(url).toContain(
      "project_path=%2Ftmp%2Frobots%2Fbarr-e%2Fbarr-e.project.yaml"
    );
  });

  it("passes through http and https URLs unchanged", () => {
    expect(
      resolveViewerAssetUrl("http://example.com/model.glb", "")
    ).toBe("http://example.com/model.glb");
    expect(
      resolveViewerAssetUrl("https://example.com/model.glb", undefined)
    ).toBe("https://example.com/model.glb");
  });

  it("fails when resolving project-relative paths without project context", () => {
    expect(() => resolveViewerAssetUrl("assets/model.glb", "")).toThrow(
      /without an active project path/
    );
  });

  it("fails unsupported scheme paths with a clear message", () => {
    expect(() => resolveViewerAssetUrl("file:///tmp/model.glb", "/tmp/demo.project.yaml")).toThrow(
      /Unsupported viewer asset URL scheme/
    );
  });
});
