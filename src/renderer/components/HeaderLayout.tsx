import React, { useEffect } from "react";

type HeaderLayoutProps = {
  onReady?: () => void;
};

export default function HeaderLayout({ onReady }: HeaderLayoutProps) {
  useEffect(() => {
    onReady?.();
  }, [onReady]);

  return (
    <>
      <img className="header-logo" src="./static/images/logo.png" alt="Robotick logo" />
      <nav>
        <div className="nav-menu-dev">
          <a href="/">Home</a>
          <select id="current-project-combo" className="project-combo"></select>
        </div>
        <div className="nav-menu-dev">
          <a href="/project">Project</a>
          <a href="/models">Models</a>
        </div>
        <div className="nav-menu-test">
          <div className="nav-submenu-control">
            <select id="launcher-profile-combo" className="launcher-combo"></select>
            <a className="launcher-control">
              <span className="icon-play">▶</span>
            </a>
            <a className="launcher-control">
              <span className="icon-restart">↻</span>
            </a>
            <a className="launcher-control-dots">
              <span className="launcher-dots">
                <span className="dot"></span>
                <span className="dot"></span>
                <span className="dot"></span>
              </span>
            </a>
          </div>
          <div className="nav-submenu-pages">
            <a href="/remote-control">Remote Control</a>
            <a href="/telemetry">Telemetry</a>
            <a href="/terminal">Terminal</a>
          </div>
        </div>
        <a href="/help">Help</a>
      </nav>
      <div className="header-right">{/* optional */}</div>
    </>
  );
}
