import React from "react";
import { NavLink } from "react-router-dom";
import { LauncherControls } from "./LauncherControls";
import { ProfilePicker } from "./ProfilePicker";
import { ProjectPicker } from "./ProjectPicker";

export function AppHeader() {
  return (
    <header className="app-header">
      <img
        className="header-logo"
        src="./static/images/logo.png"
        alt="Robotick logo"
      />

      <nav>
        <div className="nav-menu-dev">
          <NavLink to="/home">Home</NavLink>
          <ProjectPicker />
        </div>

        <div className="nav-menu-dev">
          <NavLink to="/project">Project</NavLink>
          <NavLink to="/models">Models</NavLink>
        </div>

        <div className="nav-menu-test">
          <div className="nav-submenu-control">
            <ProfilePicker />
            <LauncherControls />
          </div>
          <div className="nav-submenu-pages">
            <NavLink to="/remote-control">Remote Control</NavLink>
            <NavLink to="/telemetry">Telemetry</NavLink>
            <NavLink to="/terminal">Terminal</NavLink>
          </div>
        </div>

        <NavLink to="/help">Help</NavLink>
      </nav>

      <div className="header-right"></div>
    </header>
  );
}
