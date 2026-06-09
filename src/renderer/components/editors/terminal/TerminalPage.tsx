import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { AnsiUp } from "ansi_up";
import { terminalLogService } from "../../../data-sources/launcher";
import {
  definePanelPersistence,
  defineStudioPanel,
  usePanelSettings,
} from "../../workspaces/PanelInstanceContext";
import styles from "./TerminalPage.module.css";

type TerminalPanelSettings = {
  filter: string;
  wrapText: boolean;
  autoScroll: boolean;
};

const DEFAULT_TERMINAL_PANEL_SETTINGS: TerminalPanelSettings = {
  filter: "",
  wrapText: true,
  autoScroll: true,
};

export const terminalPagePersistence =
  definePanelPersistence<TerminalPanelSettings>({
    schemaVersion: 1,
    defaults: DEFAULT_TERMINAL_PANEL_SETTINGS,
    sanitize(value) {
      const input =
        value && typeof value === "object"
          ? (value as Partial<TerminalPanelSettings>)
          : {};
      return {
        filter:
          typeof input.filter === "string"
            ? input.filter
            : DEFAULT_TERMINAL_PANEL_SETTINGS.filter,
        wrapText:
          typeof input.wrapText === "boolean"
            ? input.wrapText
            : DEFAULT_TERMINAL_PANEL_SETTINGS.wrapText,
        autoScroll:
          typeof input.autoScroll === "boolean"
            ? input.autoScroll
            : DEFAULT_TERMINAL_PANEL_SETTINGS.autoScroll,
      };
    },
  });

export function TerminalPage() {
  const [, forceRefresh] = useReducer((count) => count + 1, 0);
  const containerRef = useRef<HTMLDivElement>(null);
  const ansiUpRef = useRef<AnsiUp | null>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const [settings, updateSettings] = usePanelSettings(terminalPagePersistence);

  useEffect(() => {
    ansiUpRef.current = new AnsiUp();
  }, []);

  useEffect(() => {
    return terminalLogService.subscribe(() => forceRefresh());
  }, []);

  const messages = terminalLogService.getMessages();
  const { filter, wrapText, autoScroll } = settings;
  const clearOnRun = terminalLogService.getClearOnRun();

  useLayoutEffect(() => {
    if (!autoScroll) return;
    if (!containerRef.current) return;

    queueMicrotask(() => {
      const el = containerRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    });
  }, [messages, filter, autoScroll]);

  function renderMessages() {
    const ansiUp = ansiUpRef.current;
    if (!ansiUp) return null;

    return messages
      .filter((msg) =>
        filter ? msg.toLowerCase().includes(filter.toLowerCase()) : true
      )
      .map((msg, i) => {
        const html = ansiUp.ansi_to_html(msg);
        return <div key={i} dangerouslySetInnerHTML={{ __html: html }} />;
      });
  }

  return (
    <div className={styles.terminalPage}>
      <div className={styles.toolbar}>
        <div className={styles.filterInputWrapper}>
          <input
            id="log-filter"
            ref={filterInputRef}
            className={styles.filterInput}
            type="text"
            placeholder="Enter filter string..."
            value={filter}
            onChange={(event) => updateSettings({ filter: event.target.value })}
          />
          {filter ? (
            <button
              type="button"
              className={styles.clearFilterButton}
              aria-label="Clear filter"
              onClick={() => {
                updateSettings({ filter: "" });
                filterInputRef.current?.focus();
              }}
            >
              ×
            </button>
          ) : null}
        </div>

        <label>
          <input
            id="wrap-text"
            type="checkbox"
            checked={wrapText}
            onChange={(event) =>
              updateSettings({ wrapText: event.target.checked })
            }
          />
          Wrap Text
        </label>

        <label>
          <input
            id="auto-scroll"
            type="checkbox"
            checked={autoScroll}
            onChange={(event) =>
              updateSettings({ autoScroll: event.target.checked })
            }
          />
          Auto Scroll
        </label>

        <label className={styles.globalSetting} title="Affects all terminal panels">
          <input
            id="clear-on-run"
            className={styles.globalCheckbox}
            type="checkbox"
            checked={clearOnRun}
            onChange={(event) =>
              terminalLogService.setClearOnRun(event.target.checked)
            }
          />
          Clear on Run
        </label>
      </div>

      <div className={styles.container} ref={containerRef}>
        <pre
          id="log"
          style={{
            whiteSpace: wrapText ? "pre-wrap" : "pre",
            margin: 0,
          }}
        >
          {renderMessages()}
        </pre>
      </div>
    </div>
  );
}

export const contribution = defineStudioPanel({
  component: TerminalPage,
  persistence: terminalPagePersistence,
});

export default TerminalPage;
