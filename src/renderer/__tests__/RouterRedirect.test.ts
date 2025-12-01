import { describe, expect, it } from "vitest";
import { shouldForceHomeRedirect } from "../Router";

describe("router bootstrap redirect heuristic", () => {
  it("forces Router to home when running from file protocol", () => {
    expect(shouldForceHomeRedirect("/any/path", "file:")).toBe(true);
  });

  it("forces Router to home when path includes bundler HTML artifacts", () => {
    expect(
      shouldForceHomeRedirect("/home/user/dist/renderer/index.html", "https:")
    ).toBe(true);
  });

  it("allows normal routes when path is friendly and protocol is http(s)", () => {
    expect(shouldForceHomeRedirect("/home", "https:")).toBe(false);
  });
});
