import React from "react";
import { Launcher, ProjectData } from "../../data-sources/launcher";
import { LauncherDots } from "./LauncherDots";
import type { LauncherStatus } from "../../data-sources/launcher";
import styles from "./styles/LauncherControls.module.css";

const useLauncherContext = Launcher.Context.use;
const useProjectData = ProjectData.use;

export function LauncherControls() {
  const {
    status,
    isBusy,
    isAwaitingStatus,
    isRobotAlive,
    lastError,
    launcherModels,
    modelHealth,
    run,
    runModel,
    stop,
    stopModel,
    restart,
    restartModel,
  } = useLauncherContext();
  const { projectModels } = useProjectData();
  const isRunning = status === "running";
  const controlActive = status !== "stopped";
  const canRestart = isRunning && !isBusy;
  const controlsDisabled = isBusy || isAwaitingStatus;
  const toggleDisabled =
    status === "stopping" || (isRunning && isAwaitingStatus)
      ? true
      : !controlActive && controlsDisabled;
  const [isStatusOpen, setIsStatusOpen] = React.useState(false);
  const statusMenuRef = React.useRef<HTMLDivElement | null>(null);
  const tooltipSummary = buildTooltipSummary(
    launcherModels,
    modelHealth,
    projectModels.data
  );
  React.useEffect(() => {
    if (!isStatusOpen) {
      return;
    }

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (target && statusMenuRef.current?.contains(target)) {
        return;
      }
      setIsStatusOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsStatusOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isStatusOpen]);

  function toggleStatusMenu() {
    setIsStatusOpen((value) => !value);
  }

  async function handleToggle() {
    if (controlActive) {
      await stop();
    } else {
      await run();
    }
  }

  async function handleRestart() {
    if (!canRestart) return;
    await restart();
  }

  return (
    <div className={styles.controlGroup}>
      <button
        type="button"
        className={styles.control}
        aria-label={controlActive ? "Stop launcher" : "Start launcher"}
        onClick={handleToggle}
        disabled={toggleDisabled}
      >
        <span
          className={`${styles.icon} ${
            controlActive ? styles.iconStop : styles.iconPlay
          }`}
        >
          {controlActive ? "⏹" : "▶"}
        </span>
      </button>

      <button
        type="button"
        className={styles.control}
        aria-label="Restart launcher"
        onClick={handleRestart}
        disabled={!canRestart || controlsDisabled}
      >
        <span className={`${styles.icon} ${styles.iconRestart}`}>↻</span>
      </button>

      <div
        ref={statusMenuRef}
        className={`${styles.statusIndicator} ${
          isStatusOpen ? styles.statusIndicatorOpen : ""
        }`}
      >
        <button
          type="button"
          className={styles.statusTrigger}
          aria-label="Toggle launcher model menu"
          aria-haspopup="menu"
          aria-expanded={isStatusOpen}
          onClick={toggleStatusMenu}
        >
          <LauncherDots
            status={status}
            robotAlive={isRobotAlive}
            tooltipSummary={tooltipSummary}
          />
        </button>
          <div className={styles.statusTooltip} role="menu" aria-label="Launcher model controls">
          <div className={styles.statusTooltipTitle}>Launcher Models</div>
          {renderModelSection("Running", tooltipSummary.running, {
            isBusy,
            isAwaitingStatus,
            stopModel,
            runModel,
            restartModel,
          })}
          {renderModelSection("Unhealthy", tooltipSummary.unhealthy, {
            isBusy,
            isAwaitingStatus,
            stopModel,
            runModel,
            restartModel,
          })}
          {renderModelSection("Pending", tooltipSummary.pending, {
            isBusy,
            isAwaitingStatus,
            stopModel,
            runModel,
            restartModel,
          })}
          {renderModelSection("Stopped", tooltipSummary.stopped, {
            isBusy,
            isAwaitingStatus,
            stopModel,
            runModel,
            restartModel,
          })}
          {tooltipSummary.running.length === 0 &&
          tooltipSummary.unhealthy.length === 0 &&
          tooltipSummary.pending.length === 0 &&
          tooltipSummary.stopped.length === 0 ? (
            <div className={styles.statusTooltipEmpty}>
              No launcher model status available.
            </div>
          ) : null}
        </div>
      </div>

      {lastError ? (
        <span className={styles.error} role="alert">
          {lastError}
        </span>
      ) : null}
    </div>
  );
}

type TooltipRow = {
  name: string;
  modelId: string;
  isRunning: boolean;
  group: TooltipGroup;
  modelStatus: LauncherStatus;
  stateLabel: string;
  launcherStage: string | null;
  launcherStatus: string | null;
  launcherLifecycle: string | null;
  launcherReadiness: string | null;
  launcherFreshness: string | null;
  healthAlive: boolean;
};

type TooltipGroup = "running" | "unhealthy" | "pending" | "stopped";

type ModelSectionHandlers = {
  isBusy: boolean;
  isAwaitingStatus: boolean;
  stopModel: (modelId: string) => Promise<void>;
  runModel: (modelId: string) => Promise<void>;
  restartModel: (modelId: string) => Promise<void>;
};

function renderModelSection(
  label: string,
  models: TooltipRow[],
  handlers: ModelSectionHandlers
) {
  if (models.length === 0) return null;

  return (
    <div className={styles.statusTooltipSection}>
      <div className={styles.statusTooltipLabel}>{label}</div>
      {models.map((model) => (
        <ModelStatusRow key={model.name} model={model} {...handlers} />
      ))}
    </div>
  );
}

function ModelStatusRow({
  model,
  isBusy,
  isAwaitingStatus,
  stopModel,
  runModel,
  restartModel,
}: {
  model: TooltipRow;
  isBusy: boolean;
  isAwaitingStatus: boolean;
  stopModel: (modelId: string) => Promise<void>;
  runModel: (modelId: string) => Promise<void>;
  restartModel: (modelId: string) => Promise<void>;
}) {
  const controlActive = model.modelStatus !== "stopped";
  const controlsDisabled =
    isBusy ||
    isAwaitingStatus ||
    model.modelStatus === "launching" ||
    model.modelStatus === "stopping";
  const toggleDisabled =
    model.modelStatus === "launching" ||
    model.modelStatus === "stopping" ||
    (!controlActive && controlsDisabled);
  const canRestart = model.modelStatus === "running" && !isBusy;

  async function handleToggle() {
    if (controlActive) {
      await stopModel(model.modelId);
      return;
    }
    await runModel(model.modelId);
  }

  async function handleRestart() {
    if (!canRestart) return;
    await restartModel(model.modelId);
  }

  const rowClasses = [styles.statusTooltipRow];
  if (
    model.stateLabel === "failed" ||
    model.stateLabel === "stale" ||
    model.stateLabel === "stopped"
  ) {
    rowClasses.push(styles.statusTooltipRowError);
  }

  return (
    <div className={rowClasses.join(" ")}>
      <div className={styles.statusTooltipRowMain}>
        <span>{model.name}</span>
        <span className={styles.statusTooltipDetail}>{model.stateLabel}</span>
      </div>
      <div className={styles.statusTooltipRowControls}>
        <button
          type="button"
          className={styles.statusTooltipControl}
          aria-label={
            controlActive ? `Stop ${model.name}` : `Start ${model.name}`
          }
          onClick={handleToggle}
          disabled={toggleDisabled}
        >
          {controlActive ? "⏹" : "▶"}
        </button>
        <button
          type="button"
          className={styles.statusTooltipControl}
          aria-label={`Restart ${model.name}`}
          onClick={handleRestart}
          disabled={!canRestart || controlsDisabled}
        >
          ↻
        </button>
        <div className={styles.statusTooltipModelIcon}>
          <LauncherDots
            status={model.modelStatus}
            robotAlive={model.healthAlive || model.modelStatus !== "running"}
            tooltipSummary={{
              running: model.group === "running" ? [{ name: model.name }] : [],
              notRunning: model.group !== "running" ? [{ name: model.name }] : [],
            }}
          />
        </div>
      </div>
    </div>
  );
}

function buildTooltipSummary(
  launcherModels: Record<
    string,
    {
      stage?: string;
      status?: string;
      lifecycle?: string;
      readiness?: string;
      freshness?: string;
      diagnostics?: Array<{ code?: string; message?: string }>;
      logRefs?: Array<{ kind?: string; path?: string }>;
    }
  >,
  modelHealth: Record<
    string,
    {
      alive: boolean;
      loading: boolean;
      error?: string | null;
      warning?: string | null;
    }
  >,
  projectModels: Array<{ modelShortName: string }>
): {
  running: TooltipRow[];
  unhealthy: TooltipRow[];
  pending: TooltipRow[];
  stopped: TooltipRow[];
  notRunning: TooltipRow[];
} {
  const modelKeys = projectModels
    .map((model) => model.modelShortName)
    .filter((modelName) => Boolean(modelName && modelName.trim()));
  const names = Array.from(
    new Set([
      ...modelKeys,
      ...Object.keys(launcherModels),
      ...Object.keys(modelHealth),
    ])
  ).sort((left, right) => left.localeCompare(right));

  const running: TooltipRow[] = [];
  const unhealthy: TooltipRow[] = [];
  const pending: TooltipRow[] = [];
  const stopped: TooltipRow[] = [];

  for (const name of names) {
    const launcherModel = launcherModels[name];
    const health = modelHealth[name];
    const presentation = deriveTooltipPresentation(launcherModel, health);
    const launcherStage = launcherModel?.stage ?? null;
    const launcherStatus = launcherModel?.status ?? null;
    const launcherLifecycle = launcherModel?.lifecycle ?? null;
    const launcherReadiness = launcherModel?.readiness ?? null;
    const launcherFreshness = launcherModel?.freshness ?? null;
    const healthAlive = health?.alive === true;

    const row: TooltipRow = {
      name,
      modelId: name,
      isRunning: presentation.modelStatus === "running",
      group: presentation.group,
      modelStatus: presentation.modelStatus,
      stateLabel: presentation.stateLabel,
      launcherStage,
      launcherStatus,
      launcherLifecycle,
      launcherReadiness,
      launcherFreshness,
      healthAlive,
    };

    if (presentation.group === "running") {
      running.push(row);
    } else if (presentation.group === "unhealthy") {
      unhealthy.push(row);
    } else if (presentation.group === "pending") {
      pending.push(row);
    } else {
      stopped.push(row);
    }
  }

  return {
    running,
    unhealthy,
    pending,
    stopped,
    notRunning: [...unhealthy, ...pending, ...stopped],
  };
}

function deriveTooltipPresentation(
  launcherModel?: {
    stage?: string;
    status?: string;
    lifecycle?: string;
    readiness?: string;
    freshness?: string;
    diagnostics?: Array<{ code?: string; message?: string }>;
    logRefs?: Array<{ kind?: string; path?: string }>;
  },
  health?: {
    alive: boolean;
    loading: boolean;
    error?: string | null;
    warning?: string | null;
  }
) {
  const stage = launcherModel?.stage?.trim();
  const status = launcherModel?.status?.trim();
  const lifecycle = launcherModel?.lifecycle?.trim();
  const freshness = launcherModel?.freshness?.trim();
  const readiness = launcherModel?.readiness?.trim();

  if (freshness === "stale" || lifecycle === "stale") {
    return {
      group: "unhealthy" as TooltipGroup,
      modelStatus: "stopped" as LauncherStatus,
      stateLabel: "stale",
    };
  }
  if (status === "starting") {
    return {
      group: "pending" as TooltipGroup,
      modelStatus: "launching" as LauncherStatus,
      stateLabel: "launching",
    };
  }
  if (status === "stopping") {
    return {
      group: "pending" as TooltipGroup,
      modelStatus: "stopping" as LauncherStatus,
      stateLabel: "stopping",
    };
  }
  if (
    stage === "run" &&
    (status === "running" || status === "succeeded")
  ) {
    if (readiness === "pending" || freshness === "pending" || health?.loading) {
      return {
        group: "pending" as TooltipGroup,
        modelStatus: "launching" as LauncherStatus,
        stateLabel: "pending",
      };
    }
    if (health && !health.alive) {
      return {
        group: "unhealthy" as TooltipGroup,
        modelStatus: "running" as LauncherStatus,
        stateLabel: "unhealthy",
      };
    }
    const stateLabel = readiness === "ready" || status === "running" ? "running" : "launched";
    return {
      group: "running" as TooltipGroup,
      modelStatus: "running" as LauncherStatus,
      stateLabel,
    };
  }
  if (status === "failed" || lifecycle === "failed") {
    return {
      group: "unhealthy" as TooltipGroup,
      modelStatus: "stopped" as LauncherStatus,
      stateLabel: "failed",
    };
  }
  if (health?.loading) {
    return {
      group: "pending" as TooltipGroup,
      modelStatus: "stopped" as LauncherStatus,
      stateLabel: "checking",
    };
  }
  if (health?.alive) {
    return {
      group: "running" as TooltipGroup,
      modelStatus: "running" as LauncherStatus,
      stateLabel: "running",
    };
  }
  return {
    group: "stopped" as TooltipGroup,
    modelStatus: "stopped" as LauncherStatus,
    stateLabel: "stopped",
  };
}
