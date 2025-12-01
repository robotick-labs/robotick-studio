import { describe, expect, it } from "vitest";
import { resolveProjectConfigSchemaUrl } from "../../ProjectPage";

describe("resolveProjectConfigSchemaUrl", () => {
  it("builds schema URLs relative to file:// renderer paths", () => {
    const href = "file:///Users/me/dev/dist/renderer/index.html";
    const url = resolveProjectConfigSchemaUrl({ href, base: "./" });
    expect(url.toString()).toBe(
      "file:///Users/me/dev/dist/renderer/static/schemas/project-config.schema.json"
    );
  });

  it("preserves http origins when served from the web", () => {
    const href = "https://hub.robotick.org/home";
    const url = resolveProjectConfigSchemaUrl({
      href,
      base: "/",
    });
    expect(url.toString()).toBe(
      "https://hub.robotick.org/static/schemas/project-config.schema.json"
    );
  });
});
