// entry.js

import { initRouter } from "./router.js";
import { initControls } from "./launcher-controls.js";

export async function init({ host }) {
  console.log(`[Robotick Hub] Starting from host: '${host}'`);

  // Attach styles and metadata (as you already have)
  const stylesheets = [
    "css/common.css",
    "css/composer.css",
    "css/footer.css",
    "css/header.css",
    "css/remote-control.css",
    "css/telemetry.css",
    "css/visualizer.css",
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
  icon.href = "images/icon.png";
  document.head.appendChild(icon);

  const themeMeta = document.createElement("meta");
  themeMeta.name = "theme-color";
  themeMeta.content = "#222222";
  document.head.appendChild(themeMeta);

  document.title = "Hub | Robotick";

  // Load external layout HTML
  const res = await fetch("layout.html");
  const html = await res.text();
  document.body.innerHTML = html;

  // Init router and controls after DOM is in place
  initRouter();
  initControls(host);
}
