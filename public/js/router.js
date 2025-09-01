import { setProjectPath } from "./core/project.js";

let currentModule = null; // Track the currently active JS module

setProjectPath("robotick-knitware/robots/barr-e/barr-e.project.yaml");

const routes = {
'/':                { title: 'Home',            html: 'pages/home.html',              js: 'pages/home.js' },
'/composer':        { title: 'Composer',        html: 'pages/composer.html',          js: 'pages/composer.js' },
'/launcher':        { title: 'Launcher',        html: 'pages/launcher.html',          js: 'pages/launcher.js' },
'/remote-control':  { title: 'Remote Control',  html: 'pages/remote-control.html',    js: 'pages/remote-control.js' },
'/visualizer':      { title: 'Visualizer',      html: 'pages/visualizer.html',        js: 'pages/visualizer.js' },
'/telemetry':       { title: 'Telemetry',       html: 'pages/telemetry.html',         js: 'pages/telemetry.js' },
'/help':            { title: 'Help',            html: 'pages/help.html',              js: 'pages/help.js' },
};

async function render() {
    const hash = window.location.hash || '#/';
    const path = hash.slice(1);
    const route = routes[path];

    const app = document.getElementById('app');

    if (!route) {
        app.innerHTML = `<h2>404</h2><p>Page not found: ${path}</p>`;
        return;
    }

    // 👉 Call uninit() on the current module before navigating away
    if (currentModule && typeof currentModule.uninit === 'function') {
        try {
            currentModule.uninit();
        } catch (err) {
            console.warn(`⚠️ Error during uninit():`, err);
        }
    }

    try {
        const htmlPromise = fetch(route.html).then(res => res.text());
        const jsPromise = route.js ? import(`./${route.js}`) : null;

        const html = await htmlPromise;
        app.innerHTML = html;
        document.title = route.title ? `${route.title} | Hub | Robotick` : 'Hub | Robotick';

        if (jsPromise) {
            try {
                const module = await jsPromise;

                // Save as the current module for future uninit
                currentModule = module;

                if (typeof module.init === 'function') {
                    module.init();
                } else {
                    console.warn(`⚠️ Module '${route.js}' does not export an init() function`);
                }
            } catch (err) {
                console.error(`❌ Failed to load or execute module '${route.js}':`, err);
            }
        } else {
            currentModule = null;
        }

    } catch (err) {
        app.innerHTML = `<h2>Error</h2><p>${err.message}</p>`;
        console.error(err);
    }
}

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', render);

export function initRouter() {
  render();
}
