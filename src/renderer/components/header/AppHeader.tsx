import React from "react";
import { NavLink } from "react-router-dom";
import { LauncherControls } from "./LauncherControls";
import { ProfilePicker } from "./ProfilePicker";
import { ProjectPicker } from "./ProjectPicker";
import styles from "./AppHeader.module.css";

const navClassName = ({ isActive }: { isActive: boolean }) =>
  [styles.navLink, isActive ? styles.navLinkActive : ""]
    .filter(Boolean)
    .join(" ");

export function AppHeader() {
  return (
    <header className={styles.header}>
      <img
        className={styles.logo}
        src="./static/images/logo.png"
        alt="Robotick logo"
      />

      <nav className={styles.nav}>
        <div className={styles.navMenuDev}>
          <NavLink to="/home" className={navClassName}>
            Home
          </NavLink>
          <ProjectPicker />
        </div>

        <div className={styles.navMenuDev}>
          <NavLink to="/project" className={navClassName}>
            Project
          </NavLink>
          <NavLink to="/models" className={navClassName}>
            Models
          </NavLink>
        </div>

        <div className={styles.navMenuTest}>
          <div className={styles.navSubmenuControl}>
            <ProfilePicker />
            <LauncherControls />
          </div>
          <div className={styles.navSubmenuPages}>
            <NavLink to="/remote-control" className={navClassName}>
              Remote Control
            </NavLink>
            <NavLink to="/telemetry" className={navClassName}>
              Telemetry
            </NavLink>
            <NavLink to="/terminal" className={navClassName}>
              Terminal
            </NavLink>
          </div>
        </div>

        <NavLink to="/help" className={navClassName}>
          Help
        </NavLink>
      </nav>

      <div className={styles.headerRight}></div>
    </header>
  );
}
