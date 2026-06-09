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
import type { RobotickStudioProcessStats } from "../../types/robotick-globals";
import { isPrimaryWindowSession } from "../../utils/windowSession";
import {
  createPanelInstanceId,
  readStorageValue,
  setStorageValue,
} from "../../services/storage";
import styles from "./styles/AppHeader.module.css";

type ChildWindowPreset = {
  id: string;
  name: string;
  seedUrl: string;
  scope: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
};

const CHILD_WINDOW_PRESETS_STORAGE_KEY = "studio.child-window-presets.v1";
const NEW_PRESET_ID = "__new__";

function loadChildWindowPresets(): ChildWindowPreset[] {
  const raw = readStorageValue(CHILD_WINDOW_PRESETS_STORAGE_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }
        const typed = entry as Partial<ChildWindowPreset>;
        if (
          typeof typed.id !== "string" ||
          typeof typed.name !== "string" ||
          typeof typed.seedUrl !== "string" ||
          typeof typed.createdAt !== "string" ||
          typeof typed.updatedAt !== "string"
        ) {
          return null;
        }
        const basePreset = {
          id: typed.id,
          name: typed.name,
          seedUrl: typed.seedUrl,
          scope:
            typeof typed.scope === "string" && typed.scope.trim().length > 0
              ? typed.scope
              : `child-preset-${typed.id}`,
          createdAt: typed.createdAt,
          updatedAt: typed.updatedAt,
        };
        if (typeof typed.lastUsedAt === "string") {
          return { ...basePreset, lastUsedAt: typed.lastUsedAt };
        }
        return basePreset;
      })
      .filter((entry): entry is ChildWindowPreset => entry !== null);
  } catch {
    return [];
  }
}

function persistChildWindowPresets(presets: ChildWindowPreset[]): void {
  setStorageValue(CHILD_WINDOW_PRESETS_STORAGE_KEY, JSON.stringify(presets));
}

function nextDefaultPresetName(presets: ChildWindowPreset[]): string {
  const used = new Set<number>();
  const matcher = /^Child Window (\d+)$/;
  for (const preset of presets) {
    const match = matcher.exec(preset.name);
    if (!match) {
      continue;
    }
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value) && value > 0) {
      used.add(value);
    }
  }
  let index = 1;
  while (used.has(index)) {
    index += 1;
  }
  return `Child Window ${index}`;
}

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
  const { workbenches } = useAppConfig();
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
  const [windowPresets, setWindowPresets] = useState<ChildWindowPreset[]>([]);
  const [selectedWindowPresetId, setSelectedWindowPresetId] =
    useState<string>(NEW_PRESET_ID);
  const [activeChildWindowScopes, setActiveChildWindowScopes] = useState<
    Set<string>
  >(new Set<string>());
  const [isChildNameEditing, setIsChildNameEditing] = useState(false);
  const [childNameDraft, setChildNameDraft] = useState("");
  const [pendingDeletePresetId, setPendingDeletePresetId] = useState<
    string | null
  >(null);
  useEffect(() => {
    // Ensure we re-check once after hydration so we pick up the preload bridge
    // even if the first render happened before window.robotick was available.
    setUsesNativeFrame(getUsesNativeWindowFrame());
    setIsPrimaryWindow(isPrimaryWindowSession());
    setWindowPresets(loadChildWindowPresets());
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = loadChildWindowPresets();
      const nextJson = JSON.stringify(next);
      const currentJson = JSON.stringify(windowPresets);
      if (nextJson !== currentJson) {
        setWindowPresets(next);
      }
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [windowPresets]);
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
  const headerClassName = [
    styles.header,
    isStandalone ? styles.headerStandalone : "",
  ]
    .filter(Boolean)
    .join(" ");
  const { showHeaderMenu } = useContextMenu();
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
  }, []);

  useEffect(() => {
    if (!leftMenuOpen && !rightMenuOpen) {
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
        setPendingDeletePresetId(null);
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
  const handleCreateWindow = (forceNew = false) => {
    if (typeof window === "undefined") {
      return;
    }
    const now = new Date().toISOString();
    const selectedPreset = forceNew
      ? undefined
      : windowPresets.find((preset) => preset.id === selectedWindowPresetId);
    if (selectedPreset) {
      const updatedPresets = windowPresets.map((preset) =>
        preset.id === selectedPreset.id
          ? { ...preset, lastUsedAt: now, updatedAt: now }
          : preset
      );
      setWindowPresets(updatedPresets);
      persistChildWindowPresets(updatedPresets);
      window.robotick?.windowControls?.createWindow?.(
        selectedPreset.seedUrl,
        selectedPreset.scope
      );
      void refreshActiveChildWindowScopes();
      return;
    }
    const seedUrl = window.location.href;
    const presetId = createPanelInstanceId();
    const newPreset: ChildWindowPreset = {
      id: presetId,
      name: nextDefaultPresetName(windowPresets),
      seedUrl,
      scope: `child-preset-${presetId}`,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now,
    };
    const updatedPresets = [...windowPresets, newPreset];
    setWindowPresets(updatedPresets);
    setSelectedWindowPresetId(newPreset.id);
    persistChildWindowPresets(updatedPresets);
    window.robotick?.windowControls?.createWindow?.(seedUrl, newPreset.scope);
    void refreshActiveChildWindowScopes();
  };
  const selectedPresetLabel = "Child Windows";
  const childWindowDisplayName = useMemo(() => {
    if (isPrimaryWindow) {
      return null;
    }
    const match = windowPresets.find((preset) => preset.scope === currentWindowScope);
    if (match?.name) {
      return match.name;
    }
    return "Studio Window";
  }, [currentWindowScope, isPrimaryWindow, windowPresets]);
  const childPreset = useMemo(
    () => windowPresets.find((preset) => preset.scope === currentWindowScope) ?? null,
    [currentWindowScope, windowPresets]
  );
  const toggleWindowPresetMenu = () => {
    setWindowPresetMenuOpen((value) => {
      if (value) {
        setPendingDeletePresetId(null);
      }
      return !value;
    });
  };
  const handleLaunchWindowPreset = (presetId: string) => {
    setSelectedWindowPresetId(presetId);
    setWindowPresetMenuOpen(false);
    setPendingDeletePresetId(null);
    if (presetId === NEW_PRESET_ID) {
      handleCreateWindow(true);
      return;
    }
    const preset = windowPresets.find((entry) => entry.id === presetId);
    if (!preset) {
      return;
    }
    const now = new Date().toISOString();
    const updatedPresets = windowPresets.map((entry) =>
      entry.id === preset.id
        ? { ...entry, lastUsedAt: now, updatedAt: now }
        : entry
    );
    setWindowPresets(updatedPresets);
    persistChildWindowPresets(updatedPresets);
    window.robotick?.windowControls?.createWindow?.(preset.seedUrl, preset.scope);
    void refreshActiveChildWindowScopes();
  };
  const commitPresetRename = (presetId: string, nextNameRaw: string) => {
    const nextName = nextNameRaw.trim();
    const current = windowPresets.find((preset) => preset.id === presetId);
    if (!current || !nextName || nextName === current.name) {
      return;
    }
    const now = new Date().toISOString();
    const updatedPresets = windowPresets.map((preset) =>
      preset.id === presetId
        ? { ...preset, name: nextName, updatedAt: now }
        : preset
    );
    setWindowPresets(updatedPresets);
    persistChildWindowPresets(updatedPresets);
  };
  const beginChildNameEdit = () => {
    if (!childPreset) {
      return;
    }
    setChildNameDraft(childPreset.name);
    setIsChildNameEditing(true);
  };
  const commitChildNameEdit = () => {
    if (!childPreset) {
      setIsChildNameEditing(false);
      setChildNameDraft("");
      return;
    }
    commitPresetRename(childPreset.id, childNameDraft);
    setIsChildNameEditing(false);
    setChildNameDraft("");
  };
  const handleDeleteWindowPreset = (
    event: React.MouseEvent<HTMLButtonElement>,
    presetId: string
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const current = windowPresets.find((preset) => preset.id === presetId);
    if (!current) {
      return;
    }
    if (activeChildWindowScopes.has(current.scope)) {
      return;
    }
    if (pendingDeletePresetId !== presetId) {
      setPendingDeletePresetId(presetId);
      return;
    }
    const updatedPresets = windowPresets.filter((preset) => preset.id !== presetId);
    setWindowPresets(updatedPresets);
    setPendingDeletePresetId(null);
    if (selectedWindowPresetId === presetId) {
      setSelectedWindowPresetId(NEW_PRESET_ID);
    }
    persistChildWindowPresets(updatedPresets);
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
                aria-label="Select window preset"
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
                      onClick={() => handleLaunchWindowPreset(NEW_PRESET_ID)}
                    >
                      <span className={styles.windowPresetName}>
                        New Child Window
                      </span>
                    </button>
                  </div>
                  {windowPresets.map((preset) => (
                    <div
                      key={preset.id}
                      className={[
                        styles.windowPresetMenuItem,
                        selectedWindowPresetId === preset.id
                          ? styles.windowPresetMenuItemActive
                          : "",
                        activeChildWindowScopes.has(preset.scope)
                          ? styles.windowPresetMenuItemOpen
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <button
                        type="button"
                        className={styles.windowPresetSelectButton}
                        onClick={() => handleLaunchWindowPreset(preset.id)}
                      >
                        <span className={styles.windowPresetName}>
                          {preset.name}
                          {activeChildWindowScopes.has(preset.scope)
                            ? " (Active)"
                            : ""}
                        </span>
                      </button>
                      <span className={styles.windowPresetActions}>
                        <button
                          type="button"
                          className={styles.windowPresetIconButton}
                          aria-label={`Delete ${preset.name}`}
                          disabled={activeChildWindowScopes.has(preset.scope)}
                          onClick={(event) =>
                            handleDeleteWindowPreset(event, preset.id)
                          }
                        >
                          🗑
                        </button>
                      </span>
                    </div>
                  ))}
                  {pendingDeletePresetId ? (
                    <div className={styles.windowPresetDeleteConfirm}>
                      <div className={styles.windowPresetDeleteConfirmText}>
                        Delete preset "
                        {windowPresets.find(
                          (preset) => preset.id === pendingDeletePresetId
                        )?.name ?? "this preset"}
                        "? This cannot be undone.
                      </div>
                      <div className={styles.windowPresetDeleteConfirmActions}>
                        <button
                          type="button"
                          className={styles.windowPresetDeleteConfirmButton}
                          onClick={() => setPendingDeletePresetId(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className={styles.windowPresetDeleteConfirmButtonDanger}
                          onClick={(event) =>
                            handleDeleteWindowPreset(event, pendingDeletePresetId)
                          }
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
        {showWindowControls && !isPrimaryWindow && childWindowDisplayName ? (
          isChildNameEditing ? (
            <input
              className={styles.childWindowNameInput}
              data-window-interactive="true"
              value={childNameDraft}
              onChange={(event) => setChildNameDraft(event.target.value)}
              onBlur={commitChildNameEdit}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commitChildNameEdit();
                  return;
                }
                if (event.key === "Escape") {
                  setIsChildNameEditing(false);
                  setChildNameDraft("");
                }
              }}
              autoFocus
            />
          ) : (
            <button
              type="button"
              className={styles.childWindowName}
              data-window-interactive="true"
              title="Click to rename"
              onClick={beginChildNameEdit}
            >
              {childWindowDisplayName}
            </button>
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
