import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { AnsiUp } from "ansi_up";
import { terminalLogService } from "../../../data-sources/launcher";
import type { TerminalLogMessage } from "../../../data-sources/launcher";
import {
  definePanelPersistence,
  defineStudioPanel,
  usePanelSettings,
} from "../../workbenches/PanelInstanceContext";
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

function padTimePart(value: number, length = 2): string {
  return value.toString().padStart(length, "0");
}

export function formatTerminalDisplayTime(timestamp?: string): string {
  const date = timestamp ? new Date(timestamp) : new Date();
  if (!Number.isFinite(date.getTime())) {
    return "00:00:00.000";
  }
  return `${padTimePart(date.getHours())}:${padTimePart(
    date.getMinutes()
  )}:${padTimePart(date.getSeconds())}.${padTimePart(
    date.getMilliseconds(),
    3
  )}`;
}

function terminalMessageText(message: TerminalLogMessage): string {
  if (message.kind === "text") {
    return message.text;
  }
  const event = message.event;
  return `${formatTerminalDisplayTime(event.timestamp)} ${event.model_id} ${event.source_kind} ${event.line}`;
}

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
      .filter((message) =>
        filter
          ? terminalMessageText(message)
              .toLowerCase()
              .includes(filter.toLowerCase())
          : true
      )
      .map((message, i) => {
        if (message.kind === "launcher-event") {
          const event = message.event;
          const html = ansiUp.ansi_to_html(event.line);
          return (
            <div key={i} className={styles.logEntry}>
              <span className={styles.logTimestamp}>
                {formatTerminalDisplayTime(event.timestamp)}
              </span>
              <span className={styles.logModel}>{event.model_id}</span>
              <span className={styles.logSource}>{event.source_kind}</span>
              <span
                className={styles.logMessage}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>
          );
        }

        const html = ansiUp.ansi_to_html(message.text);
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
