// entry.js

import { initRouter } from "./router.js";
import { initControls } from "./components/header.js";

async function init() {
  // Attach styles and metadata (as you already have)
  const stylesheets = [
    "static/styles/common.css",
    "static/styles/footer.css",
    "static/styles/header.css",
    "static/styles/home.css",
    "static/styles/models.css",
    "static/styles/project.css",
    "static/styles/remote-control.css",
    "static/styles/telemetry.css",
    "static/styles/terminal.css",
    "static/styles/visualizer.css",
  ];
  stylesheets.forEach((href) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  });

  // Favicon + meta
  const icon = document.createElement("link");
  icon.rel = "icon";
  icon.href = "static/images/icon.png";
  document.head.appendChild(icon);

  const themeMeta = document.createElement("meta");
  themeMeta.name = "theme-color";
  themeMeta.content = "#222222";
  document.head.appendChild(themeMeta);

  document.title = "Hub | Robotick";

  // Load external layout HTML
  const res = await fetch("static/html/components/header.html");
  const html = await res.text();
  document.querySelector("header").innerHTML = html;

  // Init router and controls after DOM is in place
  initRouter();
  initControls(host);
}

const host = location.origin;
init({ host });
