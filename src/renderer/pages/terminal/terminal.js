import { launcherEvents } from "../../components/header/launcher-controls.js";

let ansiUp = null;
let ws = null;
let allMessages = []; // Keep raw messages for filtering

export async function init() {
  if (!ansiUp) {
    const ansiUpModule = await import("https://esm.sh/ansi_up@5.1.0");
    ansiUp = new ansiUpModule.default();
  }

  if (ws) {
    console.warn(
      "WebSocket already open. Call uninit() before re-initializing."
    );
    return;
  }

  const log = document.getElementById("log");
  const container = document.querySelector(".terminal-container");
  const filterBox = document.getElementById("log-filter");
  const clearOnRun = document.getElementById("clear-on-run");
  const wrapText = document.getElementById("wrap-text");

  ws = new WebSocket("ws://localhost:7081/launcher/ws/log");

  ws.onmessage = (event) => {
    const text = event.data;
    allMessages.push(text);
    appendMessage(text);
  };

  function appendMessage(text) {
    const filter = filterBox.value.trim().toLowerCase();
    if (filter && !text.toLowerCase().includes(filter)) return;

    const html = ansiUp.ansi_to_html(text);
    log.insertAdjacentHTML("beforeend", html + "<br>");
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }

  // === Filter logic ===
  filterBox.addEventListener("input", () => {
    log.innerHTML = "";
    const filter = filterBox.value.trim().toLowerCase();
    for (const msg of allMessages) {
      if (!filter || msg.toLowerCase().includes(filter)) {
        const html = ansiUp.ansi_to_html(msg);
        log.insertAdjacentHTML("beforeend", html + "<br>");
      }
    }
  });

  // === Clear on run ===
  launcherEvents.addEventListener("run-requested", () => {
    if (clearOnRun.checked) {
      allMessages = [];
      log.innerHTML = "";
      console.log("[Console] Log cleared (on run)");
    }
  });

  // === Toggle text wrapping ===
  wrapText.addEventListener("change", () => {
    if (wrapText.checked) {
      log.style.whiteSpace = "pre-wrap";
    } else {
      log.style.whiteSpace = "pre";
    }
  });

  // Ensure correct initial state
  log.style.whiteSpace = wrapText.checked ? "pre-wrap" : "pre";
}

export function uninit() {
  if (ws) {
    console.log("Closing WebSocket");
    ws.close();
    ws = null;
  }
}
