import { describe, expect, it } from "vitest";
import {
  getEditorEntry,
  listEditorEntries,
} from "../../EditorRegistry";

describe("EditorRegistry", () => {
  it("exposes every configured editor with a lazy component", () => {
    const entries = listEditorEntries();
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.Component).toBeDefined();
    }
  });

  it("allows direct lookup by editor id", () => {
    const [first] = listEditorEntries();
    expect(first).toBeDefined();
    const resolved = getEditorEntry(first.id);
    expect(resolved.id).toBe(first.id);
  });
});
