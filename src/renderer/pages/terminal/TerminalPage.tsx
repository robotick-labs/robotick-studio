// src/js/pages/terminal/terminal.tsx
import React, { useEffect, useRef, useState } from "react";
import { AnsiUp } from "ansi_up";
import { launcherEvents } from "../../core/LauncherContext";
import { getLauncherLogStreamUrl } from "../../core/launcher-interface";
import styles from "./TerminalPage.module.css";

export default function TerminalPage() {
  const [messages, setMessages] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [wrap, setWrap] = useState(true);
  const [clearOnRun, setClearOnRun] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);

  const logRef = useRef<HTMLPreElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const ansiUpRef = useRef<AnsiUp | null>(null);

  const retryTimerRef = useRef<number | null>(null);
  const retryDelayRef = useRef(1000); // exponential backoff up to 8s

  useEffect(() => {
    ansiUpRef.current = new AnsiUp();
  }, []);

  // ---------------------------------------------------------------------------
  // WebSocket + automatic reconnect + debug logs
  // ---------------------------------------------------------------------------
  useEffect(() => {
    function connect() {
      let ws: WebSocket;

      try {
        const socketUrl = getLauncherLogStreamUrl();
        ws = new WebSocket(socketUrl);
        wsRef.current = ws;
      } catch (err) {
        console.warn("[terminal] WS creation failed:", err);
        scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        console.log("[terminal] Connected");
        retryDelayRef.current = 1000; // reset backoff
      };

      ws.onerror = (ev) => {
        console.warn("[terminal] WebSocket error:", ev);
        ws.close();
      };

      ws.onclose = (ev) => {
        console.log("[terminal] Disconnected:", ev.code, ev.reason);
        scheduleReconnect();
      };

      ws.onmessage = (event) => {
        const text = event.data;
        setMessages((prev) => [...prev, text]);
      };
    }

    function scheduleReconnect() {
      if (retryTimerRef.current !== null) return;

      const delay = retryDelayRef.current;
      const capped = Math.min(delay, 8000);

      console.log(`[terminal] Reconnecting in ${capped}ms...`);

      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        retryDelayRef.current = Math.min(delay * 2, 8000);
        connect();
      }, capped);
    }

    connect();

    return () => {
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Clear log on "run-requested"
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handler = () => {
      if (clearOnRun) {
        setMessages([]);
      }
    };

    launcherEvents.addEventListener("run-requested", handler);
    return () => launcherEvents.removeEventListener("run-requested", handler);
  }, [clearOnRun]);

  // ---------------------------------------------------------------------------
  // Scroll container to bottom (correct behaviour)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!autoScroll) return;
    if (!containerRef.current) return;

    queueMicrotask(() => {
      const el = containerRef.current!;
      el.scrollTop = el.scrollHeight;
    });
  }, [messages, filter, autoScroll]);

  // ---------------------------------------------------------------------------
  // Render messages (ANSI → HTML conversion)
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // UI layout
  // ---------------------------------------------------------------------------
  return (
    <div className={styles.terminalPage}>
      <div className={styles.toolbar}>
        <input
          id="log-filter"
          type="text"
          placeholder="Enter filter string..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />

        <label>
          <input
            id="clear-on-run"
            type="checkbox"
            checked={clearOnRun}
            onChange={(e) => setClearOnRun(e.target.checked)}
          />
          Clear on Run
        </label>

        <label>
          <input
            id="wrap-text"
            type="checkbox"
            checked={wrap}
            onChange={(e) => setWrap(e.target.checked)}
          />
          Wrap Text
        </label>

        <label>
          <input
            id="auto-scroll"
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
          />
          Auto Scroll
        </label>
      </div>

      <div className={styles.container} ref={containerRef}>
        <pre
          id="log"
          ref={logRef}
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
