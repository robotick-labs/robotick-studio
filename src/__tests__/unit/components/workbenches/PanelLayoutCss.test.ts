import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("PanelLayout CSS", () => {
  it(".contextSubmenu class exists for submenu styling", () => {
    const filePath = resolve(
      __dirname,
      "../../../../renderer/components/workbenches/PanelLayout.module.css"
    );
    const css = readFileSync(filePath, "utf8");
    expect(css.indexOf(".contextSubmenu")).toBeGreaterThanOrEqual(0);
  });
});
