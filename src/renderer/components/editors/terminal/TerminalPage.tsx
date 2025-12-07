import { useEffect, useLayoutEffect, useReducer, useRef } from "react";
import { AnsiUp } from "ansi_up";
import { terminalLogService } from "../../../data-sources/launcher";
import styles from "./TerminalPage.module.css";

export default function TerminalPage() {
  const [, forceRefresh] = useReducer((count) => count + 1, 0);
  const containerRef = useRef<HTMLDivElement>(null);
  const ansiUpRef = useRef<AnsiUp | null>(null);

  useEffect(() => {
    ansiUpRef.current = new AnsiUp();
  }, []);

  useEffect(() => {
    return terminalLogService.subscribe(() => forceRefresh());
  }, []);

  const messages = terminalLogService.getMessages();
  const filter = terminalLogService.getFilter();
  const wrap = terminalLogService.getWrapText();
  const autoScroll = terminalLogService.getAutoScroll();
  const clearOnRun = terminalLogService.getClearOnRun();

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
        <input
          id="log-filter"
          type="text"
          placeholder="Enter filter string..."
          value={filter}
          onChange={(event) =>
            terminalLogService.setFilter(event.target.value)
          }
        />

        <label>
          <input
            id="clear-on-run"
            type="checkbox"
            checked={clearOnRun}
            onChange={(event) =>
              terminalLogService.setClearOnRun(event.target.checked)
            }
          />
          Clear on Run
        </label>

        <label>
          <input
            id="wrap-text"
            type="checkbox"
            checked={wrap}
            onChange={(event) =>
              terminalLogService.setWrapText(event.target.checked)
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
              terminalLogService.setAutoScroll(event.target.checked)
            }
          />
          Auto Scroll
        </label>
      </div>

      <div className={styles.container} ref={containerRef}>
        <pre
          id="log"
          style={{
            whiteSpace: wrap ? "pre-wrap" : "pre",
            margin: 0,
          }}
        >
          {renderMessages()}
        </pre>
      </div>
    </div>
  );
}
