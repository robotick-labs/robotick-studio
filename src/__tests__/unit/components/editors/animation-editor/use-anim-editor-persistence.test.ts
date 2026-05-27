import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  PERSISTED_ANIM_EDITOR_STATE_VERSION,
  parsePersistedAnimEditorState,
  resolveInitialPersistedAnimEditorState,
  useAnimEditorPersistence,
} from "../../../../../renderer/components/editors/animation-editor/hooks/useAnimEditorPersistence";

describe("anim editor persistence migration", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("preserves legacy persisted tool selection while normalizing the version", () => {
    const parsed = parsePersistedAnimEditorState(
      JSON.stringify({
        activeTool: "Pencil",
        selectedClipPath: "content/anim/clips/base.animclip.yaml",
      })
    );

    expect(parsed).toEqual(
      expect.objectContaining({
        persistenceVersion: PERSISTED_ANIM_EDITOR_STATE_VERSION,
        activeTool: "Pencil",
        selectedClipPath: "content/anim/clips/base.animclip.yaml",
      })
    );
  });

  it("preserves explicit v2 tool selection, including none", () => {
    const active = parsePersistedAnimEditorState(
      JSON.stringify({
        persistenceVersion: PERSISTED_ANIM_EDITOR_STATE_VERSION,
        activeTool: "Warp",
      })
    );
    const none = parsePersistedAnimEditorState(
      JSON.stringify({
        persistenceVersion: PERSISTED_ANIM_EDITOR_STATE_VERSION,
        activeTool: null,
      })
    );

    expect(active?.activeTool).toBe("Warp");
    expect(none?.activeTool).toBeNull();
  });

  it("migrates normalized tool state from the legacy storage key into the panel key", () => {
    const panelStorageKey = "robotick-studio.anim-editor.state.v2.workspace.panel-1";
    const legacyStorageKey = "robotick-studio.anim-editor.state.v1";
    window.localStorage.setItem(
      legacyStorageKey,
      JSON.stringify({
        activeTool: "Pencil",
        selectedClipPath: "content/anim/clips/base.animclip.yaml",
      })
    );

    const resolved = resolveInitialPersistedAnimEditorState(
      panelStorageKey,
      legacyStorageKey
    );
    const migratedRaw = window.localStorage.getItem(panelStorageKey);

    expect(resolved?.activeTool).toBe("Pencil");
    expect(migratedRaw).not.toBeNull();
    expect(JSON.parse(migratedRaw ?? "null")).toEqual(
      expect.objectContaining({
        persistenceVersion: PERSISTED_ANIM_EDITOR_STATE_VERSION,
        activeTool: "Pencil",
        selectedClipPath: "content/anim/clips/base.animclip.yaml",
      })
    );
  });

  it("writes the latest normalized state to both panel and fallback storage keys", async () => {
    const panelStorageKey =
      "robotick-studio.anim-editor.state.v1.workspace.panel-1";
    const legacyStorageKey = "robotick-studio.anim-editor.state.v1";

    function Harness() {
      useAnimEditorPersistence(panelStorageKey, legacyStorageKey, {
        persistenceVersion: PERSISTED_ANIM_EDITOR_STATE_VERSION,
        activeTool: "Warp",
        warpMode: "time+value",
        warpTimeStrength: 0.75,
        smoothRangeSec: 0.33,
      });
      return null;
    }

    render(React.createElement(Harness));

    await waitFor(() => {
      expect(window.localStorage.getItem(panelStorageKey)).not.toBeNull();
      expect(window.localStorage.getItem(legacyStorageKey)).not.toBeNull();
    });

    expect(JSON.parse(window.localStorage.getItem(panelStorageKey) ?? "null")).toEqual(
      expect.objectContaining({
        persistenceVersion: PERSISTED_ANIM_EDITOR_STATE_VERSION,
        activeTool: "Warp",
        warpTimeStrength: 0.75,
        smoothRangeSec: 0.33,
      })
    );
    expect(JSON.parse(window.localStorage.getItem(legacyStorageKey) ?? "null")).toEqual(
      expect.objectContaining({
        persistenceVersion: PERSISTED_ANIM_EDITOR_STATE_VERSION,
        activeTool: "Warp",
        warpTimeStrength: 0.75,
        smoothRangeSec: 0.33,
      })
    );
  });
});
