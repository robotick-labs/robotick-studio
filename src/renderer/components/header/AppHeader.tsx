import React, { useMemo, useCallback } from "react";
import { NavLink } from "react-router-dom";
import { LauncherControls } from "./LauncherControls";
import { ProfilePicker } from "./ProfilePicker";
import { ProjectPicker } from "./ProjectPicker";
import { useAppConfig } from "../../services/AppConfigService";
import { WindowControls } from "./WindowControls";
import { isStandaloneElectron } from "../../utils/environment";
import { useContextMenu } from "../context-menu/ContextMenuProvider";
import styles from "./styles/AppHeader.module.css";

const navClassName = ({ isActive }: { isActive: boolean }) =>
  [styles.navLink, isActive ? styles.navLinkActive : ""]
    .filter(Boolean)
    .join(" ");

export function AppHeader() {
  const { workspaces } = useAppConfig();
  const grouped = useMemo(
    () => groupWorkspaces(workspaces),
    [workspaces]
  );
  const isStandalone = isStandaloneElectron();
  const noDragClass = isStandalone ? styles.noDrag : "";
  const headerClassName = [
    styles.header,
    isStandalone ? styles.headerStandalone : "",
  ]
    .filter(Boolean)
    .join(" ");
  const { showHeaderMenu } = useContextMenu();
  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      if (!isStandalone) return;
      event.preventDefault();
      event.stopPropagation();
      showHeaderMenu({ x: event.clientX, y: event.clientY });
    },
    [isStandalone, showHeaderMenu]
  );

  return (
    <header className={headerClassName} onContextMenu={handleContextMenu}>
      <img
        className={`${styles.logo} ${noDragClass}`.trim()}
        src="./static/images/logo.png"
        alt="Robotick logo"
      />

      <nav className={[styles.nav, noDragClass].filter(Boolean).join(" ")}>
        <div className={styles.navMenuProject}>
          <div className={styles.navLinks}>
            {renderLinks(grouped.projectSelect)}
          </div>
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

        <div className={styles.navMenuHelp}>
          {renderLinks(grouped.help)}
        </div>
      </nav>

      <div className={[styles.headerRight, noDragClass].filter(Boolean).join(" ")}>
        {isStandalone ? <WindowControls /> : null}
      </div>
    </header>
  );
}

function renderLinks(workspaces: { id: string; path: string; label: string }[]) {
  if (!workspaces.length) return null;
  return workspaces.map((workspace) => (
    <NavLink key={workspace.id} to={workspace.path} className={navClassName}>
      {workspace.label}
    </NavLink>
  ));
}

function groupWorkspaces(
  workspaces: { id: string; path: string; label: string; group: string }[]
) {
  const groups = {
    projectSelect: [] as { id: string; path: string; label: string }[],
    dev: [] as { id: string; path: string; label: string }[],
    test: [] as { id: string; path: string; label: string }[],
    help: [] as { id: string; path: string; label: string }[],
  };
  for (const workspace of workspaces) {
    switch (workspace.group) {
      case "project-select":
        groups.projectSelect.push(workspace);
        break;
      case "dev":
        groups.dev.push(workspace);
        break;
      case "test":
        groups.test.push(workspace);
        break;
      case "help":
        groups.help.push(workspace);
        break;
      default:
        break;
    }
  }
  return groups;
}
