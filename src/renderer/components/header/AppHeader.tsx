import React, { useMemo } from "react";
import { NavLink } from "react-router-dom";
import { LauncherControls } from "./LauncherControls";
import { ProfilePicker } from "./ProfilePicker";
import { ProjectPicker } from "./ProjectPicker";
import { useAppConfig } from "../../services/AppConfigService";
import styles from "./styles/AppHeader.module.css";

const navClassName = ({ isActive }: { isActive: boolean }) =>
  [styles.navLink, isActive ? styles.navLinkActive : ""]
    .filter(Boolean)
    .join(" ");

export function AppHeader() {
  const { routes } = useAppConfig();
  const grouped = useMemo(
    () => groupRoutes(routes),
    [routes]
  );

  return (
    <header className={styles.header}>
      <img
        className={styles.logo}
        src="./static/images/logo.png"
        alt="Robotick logo"
      />

      <nav className={styles.nav}>
        <div className={styles.navMenuProject}>
          <div className={styles.navLinks}>{renderLinks(grouped.projectSelect)}</div>
          <ProjectPicker />
        </div>

        <div className={styles.navMenuDev}>
          <div className={styles.navLinks}>{renderLinks(grouped.dev)}</div>
        </div>

        <div className={styles.navMenuTest}>
          <div className={styles.navSubmenuControl}>
            <ProfilePicker />
            <LauncherControls />
          </div>
          <div className={styles.navSubmenuPages}>
            {renderLinks(grouped.test)}
          </div>
        </div>

        <div className={styles.navMenuHelp}>{renderLinks(grouped.help)}</div>
      </nav>

      <div className={styles.headerRight}></div>
    </header>
  );
}

function renderLinks(routes: { id: string; path: string; label: string }[]) {
  if (!routes.length) return null;
  return routes.map((route) => (
    <NavLink key={route.id} to={route.path} className={navClassName}>
      {route.label}
    </NavLink>
  ));
}

function groupRoutes(
  routes: { id: string; path: string; label: string; group: string }[]
) {
  const groups = {
    projectSelect: [] as { id: string; path: string; label: string }[],
    dev: [] as { id: string; path: string; label: string }[],
    test: [] as { id: string; path: string; label: string }[],
    help: [] as { id: string; path: string; label: string }[],
  };
  for (const route of routes) {
    switch (route.group) {
      case "project-select":
        groups.projectSelect.push(route);
        break;
      case "dev":
        groups.dev.push(route);
        break;
      case "test":
        groups.test.push(route);
        break;
      case "help":
        groups.help.push(route);
        break;
      default:
        break;
    }
  }
  return groups;
}
