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

  // Restore accumulated content
  log.innerHTML = accumulatedMessages;
  log.scrollTop = log.scrollHeight;

  ws.onmessage = (event) => {
    const html = ansiUp.ansi_to_html(event.data);

    // Keep it in memory
    accumulatedMessages += html + "<br>";

    // Add to DOM
    const div = document.createElement("div");
    div.innerHTML = html;
    log.appendChild(div);

    // Always scroll to bottom
    log.scrollTo = log.scrollHeight;
  };

  ws.onopen = () => console.log("WebSocket connected");
  ws.onclose = () => {
    console.log("WebSocket closed");
    ws = null;
  };
}

export function uninit() {
  if (ws) {
    console.log("Closing WebSocket");
    ws.close();
    ws = null;
  }
}
