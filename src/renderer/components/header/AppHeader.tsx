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
import { useProjectContext } from "../../data-sources/launcher/internal/ProjectContext";
import { WindowControls } from "./WindowControls";
import { isStandaloneElectron } from "../../utils/environment";
import { addDocumentEventListener } from "../../utils/domEnvironment";
import { useContextMenu } from "../context-menu/ContextMenuProvider";
import {
  getBrowserStudioPersistenceStore,
  loadStudioPersistence,
  writeStudioDocument,
} from "../../services/studio-persistence";
import type { RobotickStudioProcessStats } from "../../types/robotick-globals";
import { isPrimaryWindowSession } from "../../utils/windowSession";
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

function getStudioProcessAPI() {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.robotick?.studioProcess;
}

function formatStudioProcessStats(stats: RobotickStudioProcessStats): string {
  const cpuPercent =
    typeof stats.cpuPercent === "number" && Number.isFinite(stats.cpuPercent)
      ? Math.max(0, stats.cpuPercent)
      : 0;
  const memoryMb =
    typeof stats.memoryMb === "number" && Number.isFinite(stats.memoryMb)
      ? Math.max(0, Math.round(stats.memoryMb))
      : 0;
  return `Studio: CPU ${cpuPercent.toFixed(1)}% Mem: ${memoryMb}MB`;
}

/**
 * Renders the application header with logo, grouped navigation links, profile and launcher controls, and optional window controls.
 *
 * When running in standalone mode without a native window frame, registers a contextmenu handler on the document that opens the header's context menu at the click coordinates unless the event target is inside an interactive element.
 *
 * @returns The header element containing the logo, workbench-grouped navigation links, pickers/controls, and conditional window controls.
 */
export function AppHeader() {
  const { projectPath } = useProjectContext();
  const { workbenches, windows } = useAppConfig();
  const grouped = useMemo(() => groupWorkbenches(workbenches), [workbenches]);
  const location = useLocation();
  const isStandalone = isStandaloneElectron();
  const [usesNativeFrame, setUsesNativeFrame] = useState<boolean>(() =>
    getUsesNativeWindowFrame()
  );
  const [isPrimaryWindow, setIsPrimaryWindow] = useState<boolean>(() =>
    isPrimaryWindowSession()
  );
  const [studioProcessStatsLabel, setStudioProcessStatsLabel] =
    useState<string | null>(null);
  const [leftMenuOpen, setLeftMenuOpen] = useState(false);
  const [rightMenuOpen, setRightMenuOpen] = useState(false);
  const [windowPresetMenuOpen, setWindowPresetMenuOpen] = useState(false);
  const [activeChildWindowScopes, setActiveChildWindowScopes] = useState<
    Set<string>
  >(new Set<string>());
  const [childWindowPendingDeleteId, setChildWindowPendingDeleteId] =
    useState<string | null>(null);
  const [optimisticDeletedChildWindowIds, setOptimisticDeletedChildWindowIds] =
    useState<Set<string>>(() => new Set<string>());
  useEffect(() => {
    // Ensure we re-check once after hydration so we pick up the preload bridge
    // even if the first render happened before window.robotick was available.
    setUsesNativeFrame(getUsesNativeWindowFrame());
    setIsPrimaryWindow(isPrimaryWindowSession());
  }, []);
  const showWindowControls = isStandalone && !usesNativeFrame;
  const noDragClass = isStandalone ? styles.noDrag : "";
  const currentWindowScope =
    typeof window !== "undefined"
      ? window.robotick?.environment?.windowScope ?? "primary"
      : "primary";
  const headerRef = useRef<HTMLElement | null>(null);
  const leftMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const rightMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const leftMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const rightMenuPanelRef = useRef<HTMLDivElement | null>(null);
  const windowPresetButtonRef = useRef<HTMLButtonElement | null>(null);
  const windowPresetPanelRef = useRef<HTMLDivElement | null>(null);
  const childWindowNameInputRef = useRef<HTMLInputElement | null>(null);
  const childWindowRenameCommitInFlightRef = useRef(false);
  const childWindowDeleteCommitInFlightRef = useRef(false);
  const [isRenamingChildWindow, setIsRenamingChildWindow] = useState(false);
  const [childWindowNameDraft, setChildWindowNameDraft] = useState("");
  const [optimisticChildWindowLabel, setOptimisticChildWindowLabel] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const headerClassName = [
    styles.header,
    isStandalone ? styles.headerStandalone : "",
  ]
    .filter(Boolean)
    .join(" ");
  const { showHeaderMenu } = useContextMenu();
  const childWindows = useMemo(
    () =>
      windows.filter(
        (window) =>
          window.windowRole === "child" &&
          !optimisticDeletedChildWindowIds.has(window.id)
      ),
    [optimisticDeletedChildWindowIds, windows]
  );
  const refreshActiveChildWindowScopes = useCallback(async () => {
    const scopes =
      (await window.robotick?.windowControls?.getChildWindowScopes?.()) ?? [];
    setActiveChildWindowScopes(new Set(scopes));
  }, []);
  const isWorkbenchPathActive = (workbenchPath: string) => {
    if (!workbenchPath) {
      return false;
    }
    if (workbenchPath === "/") {
      return location.pathname === "/";
    }
    const normalized =
      workbenchPath.endsWith("/") && workbenchPath !== "/"
        ? workbenchPath.slice(0, -1)
        : workbenchPath;
    return (
      location.pathname === normalized ||
      location.pathname.startsWith(`${normalized}/`)
    );
  };
  const isGroupActive = (
    group: { id: string; path: string; label: string }[]
  ) => group.some((workbench) => isWorkbenchPathActive(workbench.path));
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
    setWindowPresetMenuOpen(false);
  }, []);

  useEffect(() => {
    if (!leftMenuOpen && !rightMenuOpen && !windowPresetMenuOpen) {
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
      if (
        windowPresetMenuOpen &&
        !(
          (target && windowPresetPanelRef.current?.contains(target)) ||
          (target && windowPresetButtonRef.current?.contains(target))
        )
      ) {
        setWindowPresetMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenus();
      }
    };
    const cleanupPointer = addDocumentEventListener(
      "mousedown",
      handlePointerDown
    );
    const cleanupKeyboard = addDocumentEventListener(
      "keydown",
      handleKeyDown
    );
    return () => {
      cleanupPointer();
      cleanupKeyboard();
    };
  }, [leftMenuOpen, rightMenuOpen, windowPresetMenuOpen, closeMenus]);

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

  useEffect(() => {
    if (!showWindowControls) {
      setStudioProcessStatsLabel(null);
      return;
    }
    const win = typeof window === "undefined" ? undefined : window;
    if (!win) {
      setStudioProcessStatsLabel(null);
      return;
    }
    const api = getStudioProcessAPI();
    if (!api) {
      setStudioProcessStatsLabel(null);
      return;
    }

    let cancelled = false;
    const pollStats = async () => {
      try {
        const stats = await api.getStats();
        if (cancelled) {
          return;
        }
        setStudioProcessStatsLabel(formatStudioProcessStats(stats));
      } catch {
        if (!cancelled) {
          setStudioProcessStatsLabel("Studio: CPU --.-% Mem: --MB");
        }
      }
    };

    setStudioProcessStatsLabel("Studio: CPU --.-% Mem: --MB");
    void pollStats();
    const interval = win.setInterval(() => {
      void pollStats();
    }, 1000);

    return () => {
      cancelled = true;
      win.clearInterval(interval);
    };
  }, [showWindowControls]);

  useEffect(() => {
    if (!showWindowControls || !isPrimaryWindow) {
      return;
    }
    void refreshActiveChildWindowScopes();
    const timer = window.setInterval(() => {
      void refreshActiveChildWindowScopes();
    }, 1500);
    return () => {
      window.clearInterval(timer);
    };
  }, [showWindowControls, isPrimaryWindow, refreshActiveChildWindowScopes]);

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
  const handleCreateWindow = () => {
    if (typeof window === "undefined") {
      return;
    }
    setWindowPresetMenuOpen(false);
    window.robotick?.windowControls?.createWindow?.(projectPath);
    void refreshActiveChildWindowScopes();
  };
  const selectedPresetLabel = "Child Windows";
  const childWindowDisplayName = useMemo(() => {
    if (isPrimaryWindow) {
      return null;
    }
    if (optimisticChildWindowLabel?.id === currentWindowScope) {
      return optimisticChildWindowLabel.label;
    }
    const match = childWindows.find((window) => window.id === currentWindowScope);
    if (match?.label) {
      return match.label;
    }
    return "Studio Window";
  }, [
    childWindows,
    currentWindowScope,
    isPrimaryWindow,
    optimisticChildWindowLabel,
  ]);
  const handleLaunchChildWindow = (windowId: string) => {
    setWindowPresetMenuOpen(false);
    window.robotick?.windowControls?.createWindow?.(projectPath, windowId);
    void refreshActiveChildWindowScopes();
  };
  const requestDeleteChildWindow = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, windowId: string) => {
      event.preventDefault();
      event.stopPropagation();
      if (activeChildWindowScopes.has(windowId)) {
        return;
      }
      setChildWindowPendingDeleteId(windowId);
    },
    [activeChildWindowScopes]
  );
  const cancelDeleteChildWindow = useCallback(() => {
    setChildWindowPendingDeleteId(null);
  }, []);
  const confirmDeleteChildWindow = useCallback(
    async (windowId: string) => {
      if (
        childWindowDeleteCommitInFlightRef.current ||
        activeChildWindowScopes.has(windowId)
      ) {
        return;
      }
      const studioPersistenceStore = getBrowserStudioPersistenceStore();
      if (!projectPath || !studioPersistenceStore) {
        setChildWindowPendingDeleteId(null);
        return;
      }
      childWindowDeleteCommitInFlightRef.current = true;
      try {
        const loaded = await loadStudioPersistence(projectPath, studioPersistenceStore);
        const nextWindows = loaded.model.windows.filter(
          (entry) => !(entry.id === windowId && entry.windowRole === "child")
        );
        if (nextWindows.length === loaded.model.windows.length) {
          setChildWindowPendingDeleteId(null);
          return;
        }
        await writeStudioDocument(projectPath, studioPersistenceStore, {
          ...loaded.model,
          windows: nextWindows,
        });
        setOptimisticDeletedChildWindowIds((current) => {
          const next = new Set(current);
          next.add(windowId);
          return next;
        });
        setChildWindowPendingDeleteId(null);
        void refreshActiveChildWindowScopes();
      } catch (error) {
        console.warn("[AppHeader] Failed to delete child window", error);
      } finally {
        childWindowDeleteCommitInFlightRef.current = false;
      }
    },
    [activeChildWindowScopes, projectPath, refreshActiveChildWindowScopes]
  );
  const activeChildWindow = useMemo(
    () => childWindows.find((window) => window.id === currentWindowScope) ?? null,
    [childWindows, currentWindowScope]
  );
  useEffect(() => {
    if (
      optimisticChildWindowLabel &&
      optimisticChildWindowLabel.id !== currentWindowScope
    ) {
      setOptimisticChildWindowLabel(null);
    }
  }, [currentWindowScope, optimisticChildWindowLabel]);
  useEffect(() => {
    if (!isRenamingChildWindow) {
      return;
    }
    childWindowNameInputRef.current?.focus();
    childWindowNameInputRef.current?.select();
  }, [isRenamingChildWindow]);
  const beginChildWindowRename = useCallback(() => {
    if (!activeChildWindow || !childWindowDisplayName) {
      return;
    }
    setChildWindowNameDraft(childWindowDisplayName);
    setIsRenamingChildWindow(true);
  }, [activeChildWindow, childWindowDisplayName]);
  const cancelChildWindowRename = useCallback(() => {
    setIsRenamingChildWindow(false);
    setChildWindowNameDraft(childWindowDisplayName ?? "");
  }, [childWindowDisplayName]);
  const commitChildWindowRename = useCallback(async () => {
    if (childWindowRenameCommitInFlightRef.current) {
      return;
    }
    const nextLabel = childWindowNameDraft.trim();
    if (!activeChildWindow || !childWindowDisplayName || !nextLabel) {
      cancelChildWindowRename();
      return;
    }
    if (nextLabel === activeChildWindow.label) {
      setIsRenamingChildWindow(false);
      return;
    }
    const studioPersistenceStore = getBrowserStudioPersistenceStore();
    if (!projectPath || !studioPersistenceStore) {
      cancelChildWindowRename();
      return;
    }
    childWindowRenameCommitInFlightRef.current = true;
    try {
      const loaded = await loadStudioPersistence(projectPath, studioPersistenceStore);
      let renamed = false;
      const nextModel = {
        ...loaded.model,
        windows: loaded.model.windows.map((entry) => {
          if (entry.id !== activeChildWindow.id) {
            return entry;
          }
          renamed = true;
          return {
            ...entry,
            label: nextLabel,
          };
        }),
      };
      if (!renamed) {
        cancelChildWindowRename();
        return;
      }
      await writeStudioDocument(projectPath, studioPersistenceStore, nextModel);
      setOptimisticChildWindowLabel({
        id: activeChildWindow.id,
        label: nextLabel,
      });
      setChildWindowNameDraft(nextLabel);
      setIsRenamingChildWindow(false);
    } catch (error) {
      console.warn("[AppHeader] Failed to rename child window", error);
    } finally {
      childWindowRenameCommitInFlightRef.current = false;
    }
  }, [
    activeChildWindow,
    cancelChildWindowRename,
    childWindowDisplayName,
    childWindowNameDraft,
    projectPath,
  ]);
  const toggleWindowPresetMenu = () => {
    setWindowPresetMenuOpen((value) => !value);
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
        aria-label="Workbench navigation"
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
                {isPrimaryWindow ? <ProjectPicker /> : null}
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
          {isPrimaryWindow ? <ProjectPicker /> : null}
        </div>

        <div className={styles.navMenuDev}>
          <div className={styles.navLinks}>{renderLinks(grouped.dev)}</div>
        </div>

        <div className={styles.navMenuTest}>
          {isPrimaryWindow ? (
            <div className={styles.navSubmenuControl}>
              <div className={styles.profilePickerSlot}>
                <ProfilePicker />
              </div>
              <div className={styles.launcherControlsSlot}>
                <LauncherControls />
              </div>
            </div>
          ) : null}
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
            aria-label="Open workbench tools menu"
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
        {showWindowControls && isPrimaryWindow ? (
          <>
            <div className={styles.windowPresetSelector} data-window-interactive="true">
              <button
                type="button"
                className={styles.windowPresetButton}
                aria-label="Select child window"
                aria-haspopup="menu"
                aria-expanded={windowPresetMenuOpen}
                onClick={toggleWindowPresetMenu}
                ref={windowPresetButtonRef}
              >
                <span className={styles.windowPresetLabel}>{selectedPresetLabel}</span>
                <span aria-hidden="true">▾</span>
              </button>
              {windowPresetMenuOpen ? (
                <div className={styles.windowPresetMenu} role="menu" ref={windowPresetPanelRef}>
                  <div
                    className={[
                      styles.windowPresetMenuItem,
                      styles.windowPresetMenuItemInactive,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <button
                      type="button"
                      className={styles.windowPresetSelectButton}
                      onClick={handleCreateWindow}
                    >
                      <span className={styles.windowPresetName}>
                        New Child Window
                      </span>
                    </button>
                  </div>
                  {childWindows.map((childWindow) => (
                    <div
                      key={childWindow.id}
                      className={[
                        styles.windowPresetMenuItem,
                        activeChildWindowScopes.has(childWindow.id)
                          ? styles.windowPresetMenuItemOpen
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <button
                        type="button"
                        className={styles.windowPresetSelectButton}
                        onClick={() => handleLaunchChildWindow(childWindow.id)}
                      >
                        <span className={styles.windowPresetName}>
                          {childWindow.label}
                          {activeChildWindowScopes.has(childWindow.id)
                            ? " (Active)"
                            : ""}
                        </span>
                      </button>
                      <div className={styles.windowPresetActions}>
                        <button
                          type="button"
                          className={styles.windowPresetIconButton}
                          aria-label={`Delete ${childWindow.label}`}
                          title={
                            activeChildWindowScopes.has(childWindow.id)
                              ? "Close this child window before deleting it"
                              : `Delete ${childWindow.label}`
                          }
                          disabled={activeChildWindowScopes.has(childWindow.id)}
                          onClick={(event) =>
                            requestDeleteChildWindow(event, childWindow.id)
                          }
                        >
                          ×
                          <span className={styles.windowPresetIconButtonLabel}>
                            Delete
                          </span>
                        </button>
                      </div>
                      {childWindowPendingDeleteId === childWindow.id ? (
                        <div className={styles.windowPresetDeleteConfirm}>
                          <div className={styles.windowPresetDeleteConfirmText}>
                            Delete {childWindow.label} from this Studio
                            document?
                          </div>
                          <div
                            className={styles.windowPresetDeleteConfirmActions}
                          >
                            <button
                              type="button"
                              className={styles.windowPresetDeleteConfirmButton}
                              onClick={cancelDeleteChildWindow}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className={
                                styles.windowPresetDeleteConfirmButtonDanger
                              }
                              onClick={() =>
                                void confirmDeleteChildWindow(childWindow.id)
                              }
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
        {showWindowControls && !isPrimaryWindow && childWindowDisplayName ? (
          isRenamingChildWindow ? (
            <input
              ref={childWindowNameInputRef}
              className={styles.childWindowNameInput}
              data-window-interactive="true"
              aria-label="Rename child window"
              value={childWindowNameDraft}
              onChange={(event) => setChildWindowNameDraft(event.target.value)}
              onBlur={() => {
                void commitChildWindowRename();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitChildWindowRename();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelChildWindowRename();
                }
              }}
            />
          ) : (
            <span
              className={styles.childWindowName}
              data-window-interactive="true"
              title={activeChildWindow?.label ?? childWindowDisplayName}
              role="button"
              tabIndex={0}
              aria-label="Rename child window"
              onClick={beginChildWindowRename}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  beginChildWindowRename();
                }
              }}
            >
              {childWindowDisplayName}
            </span>
          )
        ) : null}
        {showWindowControls && studioProcessStatsLabel ? (
          <span
            className={[styles.studioProcessStats, noDragClass]
              .filter(Boolean)
              .join(" ")}
            data-window-interactive="true"
            data-testid="studio-process-stats"
          >
            {studioProcessStatsLabel}
          </span>
        ) : null}
        {showWindowControls ? <WindowControls /> : null}
      </div>
    </header>
  );
}

function renderLinks(
  workbenches: { id: string; path: string; label: string }[],
  onNavigate?: () => void
) {
  if (!workbenches.length) return null;
  return workbenches.map((workbench) => (
    <NavLink
      key={workbench.id}
      to={workbench.path}
      className={navClassName}
      onClick={onNavigate}
      data-window-interactive="true"
    >
      {workbench.label}
    </NavLink>
  ));
}

function groupWorkbenches(
  workbenches: { id: string; path: string; label: string; group: string }[]
) {
  const groups = {
    projectSelect: [] as { id: string; path: string; label: string }[],
    dev: [] as { id: string; path: string; label: string }[],
    test: [] as { id: string; path: string; label: string }[],
    help: [] as { id: string; path: string; label: string }[],
  };
  for (const workbench of workbenches) {
    switch (workbench.group) {
      case "project-select":
        groups.projectSelect.push(workbench);
        break;
      case "dev":
        groups.dev.push(workbench);
        break;
      case "test":
        groups.test.push(workbench);
        break;
      case "help":
        groups.help.push(workbench);
        break;
      default:
        break;
    }
  }
  return groups;
}
