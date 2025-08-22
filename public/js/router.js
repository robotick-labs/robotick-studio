import { setProjectPath } from "./core/project.js";

setProjectPath("robotick-knitware/robots/barr-e/barr-e.project.yaml");

const routes = {
'/':                { title: 'Home',            html: 'pages/home.html',              js: 'pages/home.js' },
'/composer':        { title: 'Composer',        html: 'pages/composer.html',          js: 'pages/composer.js' },
'/launcher':        { title: 'Launcher',        html: 'pages/launcher.html',          js: 'pages/launcher.js' },
'/remote-control':  { title: 'Remote Control',  html: 'pages/remote-control.html',    js: 'pages/remote-control.js' },
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

    try {
        const htmlPromise = fetch(route.html).then(res => res.text());
        const jsPromise = route.js ? import(`./${route.js}`) : null;

        // Wait for the HTML first
        const html = await htmlPromise;
        const app = document.getElementById('app');
        app.innerHTML = html;
        document.title = route.title ? `${route.title} | Hub | Robotick` : 'Hub | Robotick';

        // Now wait for the JS if needed
        if (jsPromise) {
            try {
                const module = await jsPromise;

                if (typeof module.init === 'function') {
                    module.init();
                } else {
                    console.warn(`⚠️ Module '${route.js}' does not export an init() function`);
                }
            } catch (err) {
                console.error(`❌ Failed to load or execute module '${route.js}':`, err);
            }
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
