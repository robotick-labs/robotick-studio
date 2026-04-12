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
  const toggleDisabled = status === "stopping" ? true : !controlActive && controlsDisabled;
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
          {tooltipSummary.running.length > 0 ? (
            <div className={styles.statusTooltipSection}>
              <div className={styles.statusTooltipLabel}>Running</div>
              {tooltipSummary.running.map((model) => (
                <ModelStatusRow
                  key={model.name}
                  model={model}
                  isBusy={isBusy}
                  isAwaitingStatus={isAwaitingStatus}
                  stopModel={stopModel}
                  runModel={runModel}
                  restartModel={restartModel}
                />
              ))}
            </div>
          ) : null}
          {tooltipSummary.notRunning.length > 0 ? (
            <div className={styles.statusTooltipSection}>
              <div className={styles.statusTooltipLabel}>Not Running</div>
              {tooltipSummary.notRunning.map((model) => (
                <ModelStatusRow
                  key={model.name}
                  model={model}
                  isBusy={isBusy}
                  isAwaitingStatus={isAwaitingStatus}
                  stopModel={stopModel}
                  runModel={runModel}
                  restartModel={restartModel}
                />
              ))}
            </div>
          ) : null}
          {tooltipSummary.running.length === 0 &&
          tooltipSummary.notRunning.length === 0 ? (
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
  launcherStage: string | null;
  launcherStatus: string | null;
  healthKnown: boolean;
  healthLoading: boolean;
  healthAlive: boolean;
  healthWarning: boolean;
  detail: string | null;
};

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
  const isRunStarting =
    model.launcherStage === "run" && model.launcherStatus === "starting";
  const isDetachedLaunched =
    model.launcherStage === "run" && model.launcherStatus === "succeeded";
  const hasHealthSignal =
    model.healthLoading || model.healthAlive || model.healthWarning;
  const isRunning =
    isRunStarting ||
    (model.launcherStatus === "running" &&
      (!model.healthKnown || hasHealthSignal)) ||
    (isDetachedLaunched && hasHealthSignal);
  const modelStatus: LauncherStatus = isRunStarting
    ? "launching"
    : isRunning
      ? "running"
      : "stopped";
  const modelAlive = model.healthLoading || model.healthAlive;
  const controlActive = modelStatus !== "stopped";
  const controlsDisabled = isBusy || isAwaitingStatus;
  const toggleDisabled = !controlActive && controlsDisabled;
  const canRestart = modelStatus === "running" && !isBusy;

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
  if (!isRunning) {
    rowClasses.push(styles.statusTooltipRowError);
  }

  return (
    <div className={rowClasses.join(" ")}>
      <div className={styles.statusTooltipRowMain}>
        <span>{model.name}</span>
        {model.detail ? (
          <span className={styles.statusTooltipDetail}>{model.detail}</span>
        ) : null}
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
            status={modelStatus}
            robotAlive={modelAlive}
            tooltipSummary={{
              running: modelStatus === "running" ? [{ name: model.name }] : [],
              notRunning:
                modelStatus !== "running" ? [{ name: model.name }] : [],
            }}
          />
        </div>
      </div>
    </div>
  );
}

function buildTooltipSummary(
  launcherModels: Record<string, { stage?: string; status?: string }>,
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
  const notRunning: TooltipRow[] = [];

  for (const name of names) {
    const launcherModel = launcherModels[name];
    const health = modelHealth[name];
    const launcherStage = launcherModel?.stage ?? null;
    const launcherStatus = launcherModel?.status ?? null;
    const isRunStarting =
      launcherStage === "run" && launcherStatus === "starting";
    const isDetachedLaunched =
      launcherStage === "run" && launcherStatus === "succeeded";
    const healthKnown = Boolean(health);
    const healthLoading = health?.loading === true;
    const healthAlive = health?.alive === true;
    const healthWarning = Boolean(health?.warning?.trim());
    const hasHealthSignal = healthLoading || healthAlive || healthWarning;
    const isRunning =
      isRunStarting ||
      (launcherStatus === "running" && (!healthKnown || hasHealthSignal)) ||
      (isDetachedLaunched && hasHealthSignal);
    const detail = buildTooltipDetail(launcherModel, health);

    if (isRunning) {
      running.push({
        name,
        modelId: name,
        isRunning,
        launcherStage,
        launcherStatus,
        healthKnown,
        healthLoading,
        healthAlive,
        healthWarning,
        detail,
      });
    } else {
      notRunning.push({
        name,
        modelId: name,
        isRunning,
        launcherStage,
        launcherStatus,
        healthKnown,
        healthLoading,
        healthAlive,
        healthWarning,
        detail,
      });
    }
  }

  return { running, notRunning };
}

function buildTooltipDetail(
  launcherModel?: { stage?: string; status?: string },
  health?: {
    alive: boolean;
    loading: boolean;
    error?: string | null;
    warning?: string | null;
  }
): string | null {
  if (health?.loading) {
    return "health check pending";
  }
  if (health && !health.alive) {
    return health.error?.trim() || "flatlined";
  }
  if (launcherModel?.stage && launcherModel?.status) {
    if (
      launcherModel.stage === "run" &&
      launcherModel.status === "succeeded"
    ) {
      if (health?.warning?.trim()) {
        return `launched • health unavailable (${health.warning.trim()})`;
      }
      return "launched";
    }
    if (health?.warning?.trim()) {
      return `${launcherModel.stage} • ${launcherModel.status} • health unavailable (${health.warning.trim()})`;
    }
    return `${launcherModel.stage} • ${launcherModel.status}`;
  }
  if (health?.warning?.trim()) {
    return `health unavailable (${health.warning.trim()})`;
  }
  if (launcherModel?.status) {
    return launcherModel.status;
  }
  return null;
}
