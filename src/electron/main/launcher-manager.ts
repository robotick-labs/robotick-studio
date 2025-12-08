import { spawn, spawnSync, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";

const getWorkspaceRoot = () =>
  process.env.ROBOTICK_PROJECT_DIR ??
  process.env.ROBOTICK_WORKSPACE_ROOT ??
  process.cwd();
const resolveLauncherDir = () => {
  const launcherPathEnv = process.env.ROBOTICK_LAUNCHER_DIR;
  if (launcherPathEnv) {
    return path.isAbsolute(launcherPathEnv)
      ? launcherPathEnv
      : path.join(getWorkspaceRoot(), launcherPathEnv);
  }
  return path.join(getWorkspaceRoot(), "tools/robotick-launcher");
};
const LAUNCHER_DIR = () => resolveLauncherDir();
const VENV_DIR = () => path.join(getWorkspaceRoot(), ".studio", ".venv");
const VENV_BIN = () => path.join(VENV_DIR(), "bin");
const PYTHON_BIN = process.env.ROBOTICK_PYTHON ?? "python3";
const STATUS_URL = "http://localhost:7081/launcher/status";
const STOP_URL = "http://localhost:7081/launcher/stop";
const MAX_STOP_ATTEMPTS = 3;

let managedProcess: ChildProcess | null = null;

const launcherBin = () => path.join(VENV_BIN(), "robotick-launcher");

function pathExists(target: string) {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

function ensureVenv() {
  if (pathExists(path.join(VENV_BIN(), "python"))) {
    return;
  }
  spawnSync(PYTHON_BIN, ["-m", "venv", VENV_DIR()], {
    cwd: getWorkspaceRoot(),
    stdio: "inherit",
  });
}

function installLauncherDependencies() {
  const python = path.join(VENV_BIN(), "python");
  spawnSync(
    python,
    ["-m", "pip", "install", "--upgrade", "pip", "wheel", "setuptools"],
    { cwd: getWorkspaceRoot(), stdio: "inherit" }
  );
  spawnSync(
    python,
    ["-m", "pip", "install", "-e", `${LAUNCHER_DIR()}[dev]`],
    {
      cwd: getWorkspaceRoot(),
      stdio: "inherit",
    }
  );
}

async function waitForLauncher(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isLauncherResponding()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Launcher did not start listening in time");
}

async function isLauncherResponding() {
  try {
    const response = await fetch(STATUS_URL);
    return response.ok;
  } catch {
    return false;
  }
}

async function stopLingeringLaunchers() {
  for (let attempt = 0; attempt < MAX_STOP_ATTEMPTS; attempt += 1) {
    if (!(await isLauncherResponding())) {
      return;
    }
    try {
      await fetch(STOP_URL, { method: "POST" });
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (await isLauncherResponding()) {
    console.warn(
      "[Launcher] Existing listener still responding after stop attempts; continuing"
    );
  }
}

function collectLauncherPidsUnix(matchString: string): number[] {
  const result = spawnSync("ps", ["-eo", "pid=,args="], {
    encoding: "utf-8",
  });
  if (result.status !== 0 || !result.stdout) {
    return [];
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      if (!match) {
        return null;
      }
      const [, pidStr, cmd] = match;
      if (!cmd.includes(matchString)) {
        return null;
      }
      const pid = Number.parseInt(pidStr, 10);
      return Number.isNaN(pid) ? null : pid;
    })
    .filter((pid): pid is number => pid !== null);
}

function collectLauncherPidsWindows(matchString: string): number[] {
  const escapedTarget = matchString.replace(/'/g, "''");
  const script = `
$target = '${escapedTarget}'
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like "*$target*" } | Select-Object -ExpandProperty ProcessId
`.trim();
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf-8",
  });
  if (result.status !== 0 || !result.stdout) {
    return [];
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((pidStr) => {
      const pid = Number.parseInt(pidStr, 10);
      return Number.isNaN(pid) ? null : pid;
    })
    .filter((pid): pid is number => pid !== null);
}

function collectLauncherPids(targetPath: string): number[] {
  if (process.platform === "win32") {
    return collectLauncherPidsWindows(targetPath);
  }
  return collectLauncherPidsUnix(targetPath);
}

function killExistingLauncherProcesses() {
  const pids = new Set<number>([
    ...collectLauncherPids(launcherBin()),
    ...collectLauncherPids("robotick-launcher listen"),
  ]);
  if (!pids.size) {
    return;
  }
  for (const pid of pids) {
  if (!pids.length) {
    return;
  }
  for (const pid of pids) {
    try {
      process.kill(pid);
    } catch (error) {
      console.warn(`[Launcher] Failed to terminate lingering launcher pid ${pid}`, error);
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
      }
    }
  }
}

export async function ensureLauncherReady() {
  killExistingLauncherProcesses();
  await stopLingeringLaunchers();
  if (await isLauncherResponding()) {
    return;
  }
  ensureVenv();
  installLauncherDependencies();

  const bin = launcherBin();
  const root = getWorkspaceRoot();
  console.log(`[Launcher] Workspace root: ${root}`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${VENV_BIN()}${path.delimiter}${process.env.PATH ?? ""}`,
  };
  console.log(
    `[Launcher] Starting listener with cwd ${root}`,
    "project dir:",
    env.ROBOTICK_PROJECT_DIR,
  );
  managedProcess = spawn(bin, ["listen"], {
    cwd: root,
    stdio: "inherit",
    env,
  });
  managedProcess.on("exit", () => {
    managedProcess = null;
  });

  await waitForLauncher();
}

export async function stopManagedLauncher() {
  if (!managedProcess) {
    return;
  }

  try {
    await fetch(STOP_URL, { method: "POST" });
  } catch {
    // ignore
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (managedProcess && !managedProcess.killed) {
        managedProcess.kill("SIGTERM");
      }
      resolve();
    }, 3000);

    managedProcess?.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  managedProcess = null;
}
