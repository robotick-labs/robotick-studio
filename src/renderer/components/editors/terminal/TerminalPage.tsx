import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { AnsiUp } from "ansi_up";
import { terminalLogService } from "../../../data-sources/launcher";
import {
  buildNamespacedKey,
  readStorageValue,
  setStorageValue,
} from "../../../services/storage";
import { usePanelInstance } from "../../workspaces/PanelInstanceContext";
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

const LEGACY_STORAGE_KEYS = {
  filter: "robotick-studio.terminal.filter",
  wrapText: "robotick-studio.terminal.wrapText",
  autoScroll: "robotick-studio.terminal.autoScroll",
} as const;

function readLegacyBoolean(key: string, fallback: boolean): boolean {
  const raw = readStorageValue(key);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

function readTerminalPanelSettings(storageKey: string): TerminalPanelSettings {
  const legacyFallback = {
    filter:
      readStorageValue(LEGACY_STORAGE_KEYS.filter) ??
      DEFAULT_TERMINAL_PANEL_SETTINGS.filter,
    wrapText: readLegacyBoolean(
      LEGACY_STORAGE_KEYS.wrapText,
      DEFAULT_TERMINAL_PANEL_SETTINGS.wrapText
    ),
    autoScroll: readLegacyBoolean(
      LEGACY_STORAGE_KEYS.autoScroll,
      DEFAULT_TERMINAL_PANEL_SETTINGS.autoScroll
    ),
  };
  try {
    const raw = readStorageValue(storageKey);
    if (!raw) {
      return legacyFallback;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return legacyFallback;
    }
    const data = parsed as Record<string, unknown>;
    return {
      filter:
        typeof data.filter === "string" ? data.filter : legacyFallback.filter,
      wrapText:
        typeof data.wrapText === "boolean"
          ? data.wrapText
          : legacyFallback.wrapText,
      autoScroll:
        typeof data.autoScroll === "boolean"
          ? data.autoScroll
          : legacyFallback.autoScroll,
    };
  } catch {
    return legacyFallback;
  }
}

function writeTerminalPanelSettings(
  storageKey: string,
  settings: TerminalPanelSettings
) {
  setStorageValue(storageKey, JSON.stringify(settings));
}

export default function TerminalPage() {
  const [, forceRefresh] = useReducer((count) => count + 1, 0);
  const containerRef = useRef<HTMLDivElement>(null);
  const ansiUpRef = useRef<AnsiUp | null>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const panelInstance = usePanelInstance();
  const workspaceIdentifier = panelInstance.workspaceId ?? "workspace";
  const panelIdentifier = panelInstance.panelId ?? "default";
  const storageKey = buildNamespacedKey(
    "robotick-studio.terminal.panel",
    workspaceIdentifier,
    panelIdentifier
  );
  const [settings, setSettings] = useState<TerminalPanelSettings>(() =>
    readTerminalPanelSettings(storageKey)
  );

  useEffect(() => {
    ansiUpRef.current = new AnsiUp();
  }, []);

  useEffect(() => {
    setSettings(readTerminalPanelSettings(storageKey));
  }, [storageKey]);

  useEffect(() => {
    writeTerminalPanelSettings(storageKey, settings);
  }, [settings, storageKey]);

  useEffect(() => {
    return terminalLogService.subscribe(() => forceRefresh());
  }, []);

  const messages = terminalLogService.getMessages();
  const { filter, wrapText, autoScroll } = settings;
  const clearOnRun = terminalLogService.getClearOnRun();
  const updateSettings = (partial: Partial<TerminalPanelSettings>) => {
    setSettings((current) => ({ ...current, ...partial }));
  };

  useLayoutEffect(() => {
    if (!autoScroll) return;
    if (!containerRef.current) return;

    queueMicrotask(() => {
      const el = containerRef.current!;
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
