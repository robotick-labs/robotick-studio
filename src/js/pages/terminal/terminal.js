let ansiUp = null;
let ws = null;

let accumulatedMessages = "";

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

  ws = new WebSocket("ws://localhost:7081/launcher/ws/log");
  const log = document.getElementById("log");
  const container = document.querySelector(".terminal-container");

  ws.onmessage = (event) => {
    const html = ansiUp.ansi_to_html(event.data);
    log.insertAdjacentHTML("beforeend", html + "<br>");

    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  };
}

export function uninit() {
  if (ws) {
    console.log("Closing WebSocket");
    ws.close();
    ws = null;
  }
}
