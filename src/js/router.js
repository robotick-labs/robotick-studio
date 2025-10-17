let currentModule = null; // Track the currently active JS module

async function render() {
  const path = (window.location.hash || "#/").slice(2) || "home";

  // Format title nicely
  const title = path
    .replace(/[-_]/g, " ") // dashes and underscores → space
    .replace(/\b\w/g, (char) => char.toUpperCase()); // Capitalise each word

  const app = document.getElementById("app");

  // Call uninit() on the current module before navigating away
  if (currentModule && typeof currentModule.uninit === "function") {
    try {
      currentModule.uninit();
    } catch (err) {
      console.warn(`Error during uninit():`, err);
    }
  }

  try {
    const htmlPromise = fetch(`/html/pages/${path}.html`).then((res) =>
      res.text()
    );
    const jsPromise = import(
      /* @vite-ignore */
      "./pages/" + path + "/" + path + ".js"
    );

    const html = await htmlPromise;
    app.innerHTML = html;
    document.title = title ? `${title} | Hub | Robotick` : "Hub | Robotick";

    if (jsPromise) {
      try {
        const module = await jsPromise;

        // Save as the current module for future uninit
        currentModule = module;

        if (typeof module.init === "function") {
          module.init();
        } else {
          console.warn(
            `Module '${path}/${path}.js' does not export an init() function`
          );
        }
      } catch (err) {
        console.error(
          `Failed to load or execute module '${path}/${path}.js':`,
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

export function initRouter() {
  render();
}
