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
  modelStatus: LauncherStatus;
  stateLabel: string;
  launcherStage: string | null;
  launcherStatus: string | null;
  launcherLifecycle: string | null;
  launcherReadiness: string | null;
  launcherFreshness: string | null;
  healthAlive: boolean;
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
              running:
                model.modelStatus === "running" ? [{ name: model.name }] : [],
              notRunning:
                model.modelStatus !== "running" ? [{ name: model.name }] : [],
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
      groupId?: string;
      sessionId?: string;
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
    const presentation = deriveTooltipPresentation(launcherModel, health);
    const launcherStage = launcherModel?.stage ?? null;
    const launcherStatus = launcherModel?.status ?? null;
    const launcherLifecycle = launcherModel?.lifecycle ?? null;
    const launcherReadiness = launcherModel?.readiness ?? null;
    const launcherFreshness = launcherModel?.freshness ?? null;
    const healthAlive = health?.alive === true;

    if (presentation.isRunning) {
      running.push({
        name,
        modelId: name,
        isRunning: true,
        modelStatus: presentation.modelStatus,
        stateLabel: presentation.stateLabel,
        launcherStage,
        launcherStatus,
        launcherLifecycle,
        launcherReadiness,
        launcherFreshness,
        healthAlive,
      });
    } else {
      notRunning.push({
        name,
        modelId: name,
        isRunning: false,
        modelStatus: presentation.modelStatus,
        stateLabel: presentation.stateLabel,
        launcherStage,
        launcherStatus,
        launcherLifecycle,
        launcherReadiness,
        launcherFreshness,
        healthAlive,
      });
    }
  }

  return { running, notRunning };
}

function deriveTooltipPresentation(
  launcherModel?: {
    stage?: string;
    status?: string;
    lifecycle?: string;
    readiness?: string;
    freshness?: string;
    groupId?: string;
    sessionId?: string;
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
    return { isRunning: false, modelStatus: "stopped" as LauncherStatus, stateLabel: "stale" };
  }
  if (status === "starting") {
    return { isRunning: true, modelStatus: "launching" as LauncherStatus, stateLabel: "launching" };
  }
  if (status === "stopping") {
    return { isRunning: true, modelStatus: "stopping" as LauncherStatus, stateLabel: "stopping" };
  }
  if (
    stage === "run" &&
    (status === "running" || status === "succeeded")
  ) {
    const stateLabel = readiness === "ready" || status === "running" ? "running" : "launched";
    return { isRunning: true, modelStatus: "running" as LauncherStatus, stateLabel };
  }
  if (status === "failed" || lifecycle === "failed") {
    return { isRunning: false, modelStatus: "stopped" as LauncherStatus, stateLabel: "failed" };
  }
  if (health?.loading) {
    return { isRunning: false, modelStatus: "stopped" as LauncherStatus, stateLabel: "checking" };
  }
  if (health?.alive) {
    return { isRunning: true, modelStatus: "running" as LauncherStatus, stateLabel: "running" };
  }
  return { isRunning: false, modelStatus: "stopped" as LauncherStatus, stateLabel: "stopped" };
}
