import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { AnsiUp } from "ansi_up";
import {
  getTerminalMessageSource,
  getTerminalMessageTarget,
  getTerminalMessageTimestamp,
  terminalLogService,
  terminalMessageText,
} from "../../../data-sources/launcher";
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
  showRuntime: boolean;
  showStudio: boolean;
  showLineNumbers: boolean;
};

type VisibleTerminalEntry = {
  message: TerminalLogMessage;
  lineNumber: number;
};

const MAX_RENDERED_MESSAGES = 600;

const DEFAULT_TERMINAL_PANEL_SETTINGS: TerminalPanelSettings = {
  filter: "",
  wrapText: true,
  autoScroll: true,
  showRuntime: true,
  showStudio: true,
  showLineNumbers: false,
} as const;

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

function terminalMessageSearchText(message: TerminalLogMessage): string {
  const timestamp = getTerminalMessageTimestamp(message);
  const source = getTerminalMessageSource(message);
  const target = getTerminalMessageTarget(message);
  const text = terminalMessageText(message);
  if (message.kind === "launcher-event") {
    return `${formatTerminalDisplayTime(timestamp)} ${target} ${message.event.model_id} ${source} ${text}`;
  }
  return `${formatTerminalDisplayTime(timestamp)} ${target} ${source} ${text}`;
}

function selectTargetAwareTail(
  entries: VisibleTerminalEntry[],
  limit: number
): VisibleTerminalEntry[] {
  if (entries.length <= limit) {
    return entries;
  }

  const targets = Array.from(
    new Set(entries.map((entry) => getTerminalMessageTarget(entry.message)))
  );
  if (targets.length <= 1) {
    return entries.slice(-limit);
  }

  const selected = new Set<number>();
  const quota = Math.max(1, Math.floor(limit / targets.length));
  for (const target of targets) {
    let selectedForTarget = 0;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      if (getTerminalMessageTarget(entries[index].message) !== target) {
        continue;
      }
      selected.add(index);
      selectedForTarget += 1;
      if (selectedForTarget >= quota) {
        break;
      }
    }
  }

  for (
    let index = entries.length - 1;
    selected.size < limit && index >= 0;
    index -= 1
  ) {
    selected.add(index);
  }

  return Array.from(selected)
    .sort((a, b) => a - b)
    .map((index) => entries[index]);
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
        showRuntime:
          typeof input.showRuntime === "boolean"
            ? input.showRuntime
            : DEFAULT_TERMINAL_PANEL_SETTINGS.showRuntime,
        showStudio:
          typeof input.showStudio === "boolean"
            ? input.showStudio
            : DEFAULT_TERMINAL_PANEL_SETTINGS.showStudio,
        showLineNumbers:
          typeof input.showLineNumbers === "boolean"
            ? input.showLineNumbers
            : DEFAULT_TERMINAL_PANEL_SETTINGS.showLineNumbers,
      };
    },
  });

export function TerminalPage() {
  const [, forceRefresh] = useReducer((count) => count + 1, 0);
  const containerRef = useRef<HTMLDivElement>(null);
  const ansiUpRef = useRef<AnsiUp | null>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const [renderWindowEnd, setRenderWindowEnd] = useState<number | null>(null);
  const [settings, updateSettings] = usePanelSettings(terminalPagePersistence);

  useEffect(() => {
    ansiUpRef.current = new AnsiUp();
  }, []);

  useEffect(() => {
    return terminalLogService.subscribe(() => forceRefresh());
  }, []);

  const messages = terminalLogService.getMessages();
  const stats = terminalLogService.getStats();
  const {
    filter,
    wrapText,
    autoScroll,
    showRuntime,
    showStudio,
    showLineNumbers,
  } = settings;
  const clearOnRun = terminalLogService.getClearOnRun();
  const visibleEntries = useMemo(() => {
    const filterValue = filter.toLowerCase();
    const lineNumberBase = Math.max(0, stats.totalReceived - messages.length);
    return messages.reduce<VisibleTerminalEntry[]>((entries, message, index) => {
      const target = getTerminalMessageTarget(message);
      if (target === "runtime" && !showRuntime) {
        return entries;
      }
      if (target === "studio" && !showStudio) {
        return entries;
      }
      if (
        filterValue &&
        !terminalMessageSearchText(message).toLowerCase().includes(filterValue)
      ) {
        return entries;
      }
      entries.push({
        message,
        lineNumber: lineNumberBase + index + 1,
      });
      return entries;
    }, []);
  }, [filter, messages, showRuntime, showStudio, stats.totalReceived]);
  const renderedEntries = useMemo(() => {
    if (visibleEntries.length <= MAX_RENDERED_MESSAGES) {
      return visibleEntries;
    }
    if (autoScroll) {
      return selectTargetAwareTail(visibleEntries, MAX_RENDERED_MESSAGES);
    }
    const end = Math.min(
      visibleEntries.length,
      Math.max(MAX_RENDERED_MESSAGES, renderWindowEnd ?? visibleEntries.length)
    );
    return visibleEntries.slice(end - MAX_RENDERED_MESSAGES, end);
  }, [autoScroll, renderWindowEnd, visibleEntries]);
  const isWindowedRendering = renderedEntries.length < visibleEntries.length;
  const renderedStart = renderedEntries[0]?.lineNumber;
  const renderedEnd = renderedEntries.at(-1)?.lineNumber;

  useEffect(() => {
    if (autoScroll) {
      setRenderWindowEnd((current) =>
        current === visibleEntries.length ? current : visibleEntries.length
      );
      return;
    }
    setRenderWindowEnd((current) => {
      if (current === null) {
        return visibleEntries.length;
      }
      return current > visibleEntries.length ? visibleEntries.length : current;
    });
  }, [autoScroll, visibleEntries.length]);

  useLayoutEffect(() => {
    if (!autoScroll) return;
    if (!containerRef.current) return;

    queueMicrotask(() => {
      const el = containerRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    });
  }, [renderedEntries, filter, autoScroll]);

  function renderMessages() {
    const ansiUp = ansiUpRef.current;
    if (!ansiUp) return null;

    if (renderedEntries.length === 0) {
      return (
        <div className={styles.emptyState}>
          No log entries match the current target selection and filter.
        </div>
      );
    }

    return renderedEntries.map(({ message, lineNumber }, i) => {
      const target = getTerminalMessageTarget(message);
      const source = getTerminalMessageSource(message);
      if (message.kind === "launcher-event") {
        const event = message.event;
        const html = ansiUp.ansi_to_html(event.line);
        return (
          <div key={i} className={styles.logEntry}>
            {showLineNumbers ? (
              <span className={styles.logLineNumber}>{lineNumber}</span>
            ) : null}
            <span className={styles.logTimestamp}>
              {formatTerminalDisplayTime(event.timestamp)}
            </span>
            <span className={styles.logTarget}>{target}</span>
            <span className={styles.logModel}>{event.model_id}</span>
            <span className={styles.logSource}>{source}</span>
            <span
              className={styles.logMessage}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        );
      }

      if (message.kind === "studio-event") {
        const html = ansiUp.ansi_to_html(message.event.message);
        return (
          <div key={i} className={styles.logEntry}>
            {showLineNumbers ? (
              <span className={styles.logLineNumber}>{lineNumber}</span>
            ) : null}
            <span className={styles.logTimestamp}>
              {formatTerminalDisplayTime(message.event.recorded_at)}
            </span>
            <span className={styles.logTarget}>{target}</span>
            <span className={styles.logSource}>{source}</span>
            <span className={styles.logLevel}>{message.event.level}</span>
            <span
              className={styles.logMessage}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        );
      }

      const html = ansiUp.ansi_to_html(message.text);
      return (
        <div key={i} className={styles.logEntry}>
          {showLineNumbers ? (
            <span className={styles.logLineNumber}>{lineNumber}</span>
          ) : null}
          <span className={styles.logTarget}>{target}</span>
          <span className={styles.logSource}>{source}</span>
          <span
            className={styles.logMessage}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      );
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

        <label>
          <input
            id="show-runtime"
            type="checkbox"
            checked={showRuntime}
            onChange={(event) =>
              updateSettings({ showRuntime: event.target.checked })
            }
          />
          Runtime
        </label>

        <label>
          <input
            id="show-studio"
            type="checkbox"
            checked={showStudio}
            onChange={(event) =>
              updateSettings({ showStudio: event.target.checked })
            }
          />
          Studio
        </label>

        <label>
          <input
            id="show-line-numbers"
            type="checkbox"
            checked={showLineNumbers}
            onChange={(event) =>
              updateSettings({ showLineNumbers: event.target.checked })
            }
          />
          Line Numbers
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
        {isWindowedRendering ? (
          <div className={styles.renderSummary}>
            Rendering {renderedEntries.length} of {visibleEntries.length} visible
            lines ({renderedStart}-{renderedEnd})
          </div>
        ) : null}
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
