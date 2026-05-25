import React from "react";
import styles from "../AnimationEditorPage.module.css";
import type { AnimationToolDefinition, AnimationToolId, AnimationToolSettingsContext } from "./types";

type ToolHostProps = {
  tools: AnimationToolDefinition[];
  activeTool: AnimationToolId | null;
  onToggleTool: (toolId: AnimationToolId) => void;
  settingsContext: AnimationToolSettingsContext;
};

export function ToolHost({ tools, activeTool, onToggleTool, settingsContext }: ToolHostProps) {
  const sections = React.useMemo(() => {
    const map = new Map<string, AnimationToolDefinition[]>();
    tools.forEach((tool) => {
      const list = map.get(tool.section) ?? [];
      list.push(tool);
      map.set(tool.section, list);
    });
    return Array.from(map.entries()).map(([title, items]) => ({ title, items }));
  }, [tools]);

  const activeDefinition = tools.find((tool) => tool.id === activeTool) ?? null;

  return (
    <aside className={styles.animationToolBar}>
      <section className={styles.panelCard}>
        <h3>History</h3>
        <div className={styles.toolButtons}>
          <button className={styles.toolButton} type="button" title="Undo is not implemented yet." disabled>
            Undo
          </button>
          <button className={styles.toolButton} type="button" title="Redo is not implemented yet." disabled>
            Redo
          </button>
        </div>
      </section>
      {sections.map((section) => (
        <section key={section.title} className={styles.panelCard}>
          <h3>{section.title}</h3>
          <div className={styles.toolButtons}>
            {section.items.map((tool) => {
              const isActive = tool.id === activeTool;
              const isAnimTool =
                tool.id === "Pencil" ||
                tool.id === "Line" ||
                tool.id === "Range" ||
                tool.id === "Warp" ||
                tool.id === "Smooth";
              return (
                <button
                  key={tool.id}
                  className={`${styles.toolButton} ${isActive ? styles.toolButtonActive : ""}`}
                  type="button"
                  title={tool.enabled ? tool.description : `${tool.label} is not implemented yet.`}
                  disabled={!tool.enabled}
                  onClick={() => {
                    if (tool.enabled && isAnimTool) {
                      onToggleTool(tool.id as AnimationToolId);
                    }
                  }}
                >
                  <span title={tool.description}>{tool.label}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {activeDefinition?.renderSettings ? (
        <section className={styles.panelCard}>
          <h3>Tool Settings</h3>
          {activeDefinition.renderSettings(settingsContext)}
        </section>
      ) : null}
    </aside>
  );
}
