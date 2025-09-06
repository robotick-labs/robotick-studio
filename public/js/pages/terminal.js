let ansiUp = null;

export async function init() {
  if (!ansiUp) {
    const ansiUpModule = await import("https://esm.sh/ansi_up@5.1.0");
    ansiUp = new ansiUpModule.default(); // ✅ use `.default`
  }

  const ws = new WebSocket("ws://localhost:7081/launcher/ws/log");
  const log = document.getElementById("log");

  ws.onmessage = (event) => {
    const html = ansiUp.ansi_to_html(event.data);
    log.innerHTML += html + "<br>";
    log.scrollTop = log.scrollHeight;
  };

  ws.onopen = () => console.log("WebSocket connected");
  ws.onclose = () => console.log("WebSocket closed");
}
