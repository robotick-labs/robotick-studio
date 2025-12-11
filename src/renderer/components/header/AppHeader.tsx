import React, {
  useMemo,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { NavLink, useLocation } from "react-router-dom";
import { LauncherControls } from "./LauncherControls";
import { ProfilePicker } from "./ProfilePicker";
import { ProjectPicker } from "./ProjectPicker";
import { useAppConfig } from "../../services/AppConfigService";
import { WindowControls } from "./WindowControls";
import { isStandaloneElectron } from "../../utils/environment";
import { addDocumentEventListener } from "../../utils/domEnvironment";
import { useContextMenu } from "../context-menu/ContextMenuProvider";
import styles from "./styles/AppHeader.module.css";

const navClassName = ({ isActive }: { isActive: boolean }) =>
  [styles.navLink, isActive ? styles.navLinkActive : ""]
    .filter(Boolean)
    .join(" ");

/**
 * Determines whether an event target is inside an element marked with `data-window-interactive='true'`.
 *
 * @param target - The event target to check (may be `null`).
 * @returns `true` if `target` is an `Element` and is contained within an element with `data-window-interactive='true'`, `false` otherwise.
 */
function isInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(target.closest("[data-window-interactive='true']"));
}

/**
 * Determine whether the application should use the native window frame.
 *
 * @returns `true` when `window.robotick.environment.usesNativeWindowFrame` is not explicitly `false` or when `window` is unavailable, `false` otherwise.
 */
function getUsesNativeWindowFrame(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  return window.robotick?.environment?.usesNativeWindowFrame !== false;
}

/**
 * Renders the application header with logo, grouped navigation links, profile and launcher controls, and optional window controls.
 *
 * When running in standalone mode without a native window frame, registers a contextmenu handler on the document that opens the header's context menu at the click coordinates unless the event target is inside an interactive element.
 *
 * @returns The header element containing the logo, workspace-grouped navigation links, pickers/controls, and conditional window controls.
 */
export function AppHeader() {
  const { workspaces } = useAppConfig();
  const grouped = useMemo(() => groupWorkspaces(workspaces), [workspaces]);
  const location = useLocation();
  const isStandalone = isStandaloneElectron();
  const [usesNativeFrame, setUsesNativeFrame] = useState<boolean>(() =>
    getUsesNativeWindowFrame()
  );
  const [leftMenuOpen, setLeftMenuOpen] = useState(false);
  const [rightMenuOpen, setRightMenuOpen] = useState(false);
  useEffect(() => {
    // Ensure we re-check once after hydration so we pick up the preload bridge
    // even if the first render happened before window.robotick was available.
    setUsesNativeFrame(getUsesNativeWindowFrame());
  }, []);
  const showWindowControls = isStandalone && !usesNativeFrame;
  const noDragClass = isStandalone ? styles.noDrag : "";
  const headerRef = useRef<HTMLElement | null>(null);
  const leftMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const rightMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const leftMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const rightMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const headerClassName = [
    styles.header,
    isStandalone ? styles.headerStandalone : "",
  ]
    .filter(Boolean)
    .join(" ");
  const { showHeaderMenu } = useContextMenu();
  const isWorkspacePathActive = (workspacePath: string) => {
    if (!workspacePath) {
      return false;
    }
    if (workspacePath === "/") {
      return location.pathname === "/";
    }
    const normalized =
      workspacePath.endsWith("/") && workspacePath !== "/"
        ? workspacePath.slice(0, -1)
        : workspacePath;
    return (
      location.pathname === normalized ||
      location.pathname.startsWith(`${normalized}/`)
    );
  };
  const isGroupActive = (
    group: { id: string; path: string; label: string }[]
  ) => group.some((workspace) => isWorkspacePathActive(workspace.path));
  const leftMenuActive = isGroupActive([
    ...grouped.projectSelect,
    ...grouped.dev,
  ]);
  const rightMenuActive = isGroupActive([
    ...grouped.test,
    ...grouped.help,
  ]);
  const closeMenus = useCallback(() => {
    setLeftMenuOpen(false);
    setRightMenuOpen(false);
  }, []);

  useEffect(() => {
    if (!leftMenuOpen && !rightMenuOpen) {
      return;
    }
    if (typeof document === "undefined") {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = (event.target as Node) ?? null;
      if (
        leftMenuOpen &&
        !(
          (target && leftMenuPanelRef.current?.contains(target)) ||
          (target && leftMenuButtonRef.current?.contains(target))
        )
      ) {
        setLeftMenuOpen(false);
      }
      if (
        rightMenuOpen &&
        !(
          (target && rightMenuPanelRef.current?.contains(target)) ||
          (target && rightMenuButtonRef.current?.contains(target))
        )
      ) {
        setRightMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenus();
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [leftMenuOpen, rightMenuOpen, closeMenus]);

  useEffect(() => {
    if (!showWindowControls) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const header = headerRef.current;
      if (!header || !target || !header.contains(target)) {
        return;
      }
      if (isInteractiveTarget(target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      showHeaderMenu({ x: event.clientX, y: event.clientY });
    };
    return addDocumentEventListener("contextmenu", handler);
  }, [showWindowControls, showHeaderMenu]);
  const toggleLeftMenu = () => {
    setLeftMenuOpen((value) => {
      if (!value) {
        setRightMenuOpen(false);
      }
      return !value;
    });
  };
  const toggleRightMenu = () => {
    setRightMenuOpen((value) => {
      if (!value) {
        setLeftMenuOpen(false);
      }
      return !value;
    });
  };
  const handleNavigate = () => {
    closeMenus();
  };

  return (
    <header ref={headerRef} className={headerClassName}>
      <picture className={`${styles.logoPicture} ${noDragClass}`.trim()}>
        <source
          media="(max-width: 1550px)"
          srcSet="./static/images/icon-square.png"
        />
        <img
          className={styles.logo}
          src="./static/images/logo.png"
          alt="Robotick logo"
          height={40}
        />
      </picture>

      <nav
        className={[styles.nav, noDragClass].filter(Boolean).join(" ")}
        role="navigation"
        aria-label="Workspace navigation"
      >
        <div className={styles.mobileMenuToggle} data-window-interactive="true">
          <button
            type="button"
            className={[
              styles.mobileMenuButton,
              leftMenuActive ? styles.mobileMenuButtonActive : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-label="Open project navigation menu"
            aria-expanded={leftMenuOpen}
            aria-haspopup="true"
            onClick={toggleLeftMenu}
            ref={leftMenuButtonRef}
          >
            <span className={styles.menuIcon} aria-hidden="true">
              ☰
            </span>
          </button>
          {leftMenuOpen ? (
            <div
              ref={leftMenuPanelRef}
              className={styles.menuPopover}
              role="menu"
            >
              <div className={styles.projectPickerSlot}>
                <span className={styles.menuLabelText}>Project</span>
                <ProjectPicker />
              </div>
              <div className={styles.menuLinks}>
                {renderLinks(grouped.projectSelect, handleNavigate)}
              </div>
              {grouped.dev.length ? (
                <div className={styles.menuLinks}>
                  {renderLinks(grouped.dev, handleNavigate)}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

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
            <div className={styles.profilePickerSlot}>
              <ProfilePicker />
            </div>
            <div className={styles.launcherControlsSlot}>
              <LauncherControls />
            </div>
          </div>
          <div className={styles.navSubmenuPages}>
            <div className={styles.navSubmenuPagesLinks}>
              {renderLinks(grouped.test)}
            </div>
            <div
              className={`${styles.mobileMenuToggle} ${styles.mobileMenuToggleRight}`}
              data-window-interactive="true"
            >
              <button
            type="button"
            className={[
              styles.mobileMenuButton,
              rightMenuActive ? styles.mobileMenuButtonActive : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-label="Open workspace tools menu"
                aria-expanded={rightMenuOpen}
                aria-haspopup="true"
                onClick={toggleRightMenu}
                ref={rightMenuButtonRef}
              >
                <span className={styles.menuIcon} aria-hidden="true">
                  ☰
                </span>
              </button>
              {rightMenuOpen ? (
                <div
                  ref={rightMenuPanelRef}
                  className={`${styles.menuPopover} ${styles.menuPopoverRight}`}
                  role="menu"
                >
                  <div className={styles.menuLinks}>
                    {renderLinks(grouped.test, handleNavigate)}
                  </div>
                  <div className={styles.menuLinks}>
                    {renderLinks(grouped.help, handleNavigate)}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className={styles.navMenuHelp}>{renderLinks(grouped.help)}</div>
      </nav>

      <div
        className={[styles.headerRight, noDragClass].filter(Boolean).join(" ")}
      >
        {showWindowControls ? <WindowControls /> : null}
      </div>
    </header>
  );
}

function renderLinks(
  workspaces: { id: string; path: string; label: string }[],
  onNavigate?: () => void
) {
  if (!workspaces.length) return null;
  return workspaces.map((workspace) => (
    <NavLink
      key={workspace.id}
      to={workspace.path}
      className={navClassName}
      onClick={onNavigate}
      data-window-interactive="true"
    >
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
