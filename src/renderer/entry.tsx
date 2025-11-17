// entry.tsx

import { mountRouter } from "./router.js";
import { initControls } from "./components/header.js";

async function initApp() {
  // Load stylesheets
  const stylesheets = [
    "./static/styles/common.css",
    "./static/styles/footer.css",
    "./static/styles/header.css",
    "./static/styles/home.css",
    "./static/styles/models.css",
    "./static/styles/project.css",
    "./static/styles/remote-control.css",
    "./static/styles/telemetry.css",
    "./static/styles/terminal.css",
    "./static/styles/visualizer.css",
  ];

  for (const href of stylesheets) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  // Favicon
  const icon = document.createElement("link");
  icon.rel = "icon";
  icon.href = "./static/images/icon.png";
  document.head.appendChild(icon);

  // Theme color
  const themeMeta = document.createElement("meta");
  themeMeta.name = "theme-color";
  themeMeta.content = "#222222";
  document.head.appendChild(themeMeta);

  document.title = "Hub | Robotick";

  // Load header HTML
  const res = await fetch("./static/html/components/header.html");
  const headerHtml = await res.text();
  document.querySelector("header")!.innerHTML = headerHtml;

  // Router + header controls
  const app = document.getElementById("app")!;
  mountRouter(app);
  initControls(location.origin);
}

initApp();
