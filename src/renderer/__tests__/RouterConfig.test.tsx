import { describe, expect, it } from "vitest";
import { resolvedRoutes } from "../Router";

describe("Router configuration", () => {
  it("resolves lazy components for all configured routes", () => {
    expect(resolvedRoutes.length).toBeGreaterThan(0);
    for (const route of resolvedRoutes) {
      expect(route.Component).toBeDefined();
    }
  });
});
