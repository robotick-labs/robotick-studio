// entry.js

import { initRouter } from './router.js';

export function init({ host }) {
  console.log(`[Robotick Hub] Starting from host: '${host}'`);

  // Attach styles and metadata
  const stylesheets = [
    'css/common.css',
    'css/composer.css',
    'css/footer.css',
    'css/header.css',
    'css/remote-control.css',
    'css/telemetry.css'
  ];

  stylesheets.forEach(href => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  });

  // Favicon
  const icon = document.createElement('link');
  icon.rel = 'icon';
  icon.href = 'images/icon.png';
  document.head.appendChild(icon);

  // Theme color
  const themeMeta = document.createElement('meta');
  themeMeta.name = 'theme-color';
  themeMeta.content = '#222222';
  document.head.appendChild(themeMeta);

  // Page title
  document.title = 'Hub | Robotick';

  // Body structure
  document.body.innerHTML = `
    <header>
      <img class="header-logo" src="images/logo.png">
      <nav>
        <a href="#/">Home</a>
        <div class="nav-menu-dev">
          <a href="#/composer">Composer</a>
          <a href="#/launcher">Launcher</a>
        </div>
        <div class="nav-menu-test">
          <a href="#/remote-control">Remote Control</a>
          <a href="#/telemetry">Telemetry</a>
        </div>
        <a href="#/help">Help</a>
      </nav>
    </header>

    <main><div id="app" class="page-container"><em>Loading...</em></div></main>

    <footer>
      <small>© Robotick Labs</small>
    </footer>
  `;

  // Init router
  initRouter();
}
