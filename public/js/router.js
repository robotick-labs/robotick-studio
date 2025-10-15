let currentModule = null; // Track the currently active JS module

const routes = {
  "/": { title: "Home", html: "pages/home.html", js: "pages/home.js" },
  "/project": {
    title: "Project",
    html: "pages/project.html",
    js: "pages/project.js",
  },
  "/models": {
    title: "Models",
    html: "pages/models.html",
    js: "pages/models.js",
  },
  "/remote-control": {
    title: "Remote Control",
    html: "pages/remote-control.html",
    js: "pages/remote-control.js",
  },
  "/telemetry": {
    title: "Telemetry",
    html: "pages/telemetry.html",
    js: "pages/telemetry.js",
  },
  "/help": { title: "Help", html: "pages/help.html", js: "pages/help.js" },
};

async function render() {
  const path = (window.location.hash || "#/").slice(2) || "home";

  // Format title nicely
  const title = path
    .replace(/[-_]/g, " ") // dashes and underscores → space
    .replace(/\b\w/g, (char) => char.toUpperCase()); // Capitalise each word

  const route = {
    title: title,
    html: `pages/${path}.html`,
    js: `pages/${path}.js`,
  };

  console.log(route.title);
  console.log(route.html);
  console.log(route.js);

  const app = document.getElementById("app");

  if (!route) {
    app.innerHTML = `<h2>404</h2><p>Page not found: ${path}</p>`;
    return;
  }

  // 👉 Call uninit() on the current module before navigating away
  if (currentModule && typeof currentModule.uninit === "function") {
    try {
      currentModule.uninit();
    } catch (err) {
      console.warn(`⚠️ Error during uninit():`, err);
    }
  }

  try {
    const htmlPromise = fetch("/html/" + route.html).then((res) => res.text());
    const jsPromise = route.js ? import(`./${route.js}`) : null;

    const html = await htmlPromise;
    app.innerHTML = html;
    document.title = route.title
      ? `${route.title} | Hub | Robotick`
      : "Hub | Robotick";

    if (jsPromise) {
      try {
        const module = await jsPromise;

        // Save as the current module for future uninit
        currentModule = module;

        if (typeof module.init === "function") {
          module.init();
        } else {
          console.warn(
            `⚠️ Module '${route.js}' does not export an init() function`
          );
        }
      } catch (err) {
        console.error(
          `❌ Failed to load or execute module '${route.js}':`,
          err
        );
      }
    } else {
      currentModule = null;
    }
  } catch (err) {
    app.innerHTML = `<h2>Error</h2><p>${err.message}</p>`;
    console.error(err);
  }
}

window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", render);

export function initRouter() {
  render();
}
