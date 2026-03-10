import { spawn, spawnSync, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const getWorkspaceRoot = () =>
  process.env.ROBOTICK_PROJECT_DIR ??
  process.env.ROBOTICK_WORKSPACE_ROOT ??
  process.cwd();
const DEFAULT_LAUNCHER_SUBDIR = "tools/robotick-launcher";
const resolveLauncherDir = () => {
  const launcherPathEnv = process.env.ROBOTICK_LAUNCHER_DIR;
  if (launcherPathEnv) {
    return path.isAbsolute(launcherPathEnv)
      ? launcherPathEnv
      : path.join(getWorkspaceRoot(), launcherPathEnv);
  }
  const workspaceCandidate = path.join(
    getWorkspaceRoot(),
    DEFAULT_LAUNCHER_SUBDIR
  );
  if (fs.existsSync(workspaceCandidate)) {
    return workspaceCandidate;
  }
  const localCandidate = path.join(
    __dirname,
    "../../../",
    DEFAULT_LAUNCHER_SUBDIR
  );
  if (fs.existsSync(localCandidate)) {
    return localCandidate;
  }
  return workspaceCandidate;
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

/**
 * Installs and upgrades packaging tools in the project's virtual environment and installs the launcher package in editable mode from the resolved launcher directory.
 *
 * Upgrades `pip`, `wheel`, and `setuptools` inside the virtual environment, then installs `robotick-launcher[dev]` using a file URL to the launcher directory so the development package is available in the venv.
 */
function installLauncherDependencies() {
  const python = path.join(VENV_BIN(), "python");
  spawnSync(
    python,
    ["-m", "pip", "install", "--upgrade", "pip", "wheel", "setuptools"],
    { cwd: getWorkspaceRoot(), stdio: "inherit" }
  );
  const launcherDir = LAUNCHER_DIR();
  const launcherSpec = `robotick-launcher[dev] @ ${
    pathToFileURL(launcherDir).href
  }`;
  spawnSync(python, ["-m", "pip", "install", "-e", launcherSpec], {
    cwd: getWorkspaceRoot(),
    stdio: "inherit",
  });
}

/**
 * Waits until the launcher responds or the given timeout elapses.
 *
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 20000)
 * @throws Error - If the launcher does not respond before the timeout
 */
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

/**
 * Finds process IDs of Windows processes whose command line contains the given substring.
 *
 * Runs a PowerShell query for Win32_Process entries whose CommandLine matches `matchString` and returns the numeric PIDs found; returns an empty array if the query fails or no matches are found.
 *
 * @param matchString - Substring to search for inside process command lines
 * @returns An array of process IDs (numbers) matching `matchString`, or an empty array if none are found
 */
function collectLauncherPidsWindows(matchString: string): number[] {
  const escapedTarget = matchString.replace(/'/g, "''");
  const script = `
$target = '${escapedTarget}'
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like "*$target*" } | Select-Object -ExpandProperty ProcessId
`.trim();
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", script],
    {
      encoding: "utf-8",
    }
  );
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

/**
 * Terminate any lingering robotick-launcher processes found on the system.
 *
 * Collects process IDs matching the launcher binary path and the command
 * "robotick-launcher listen", attempts to kill each PID, and if that fails
 * on Windows falls back to invoking `taskkill` to force termination.
 */
function killExistingLauncherProcesses() {
  const pids = new Set<number>([
    ...collectLauncherPids(launcherBin()),
    ...collectLauncherPids("robotick-launcher listen"),
  ]);
  if (!pids.size) {
    return;
  }
  for (const pid of pids) {
    try {
      process.kill(pid);
    } catch (error) {
      console.warn(
        `[Launcher] Failed to terminate lingering launcher pid ${pid}`,
        error
      );
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
          stdio: "ignore",
        });
      }
    }
  }
}

/**
 * Ensure the robotick launcher is installed, running, and responding to status requests.
 *
 * This prepares a Python virtual environment and launcher dependencies if needed, terminates
 * any existing launcher processes, starts a managed launcher listener, and waits until the
 * launcher responds to status checks.
 *
 * @returns Resolves when the launcher is running and responding to the status endpoint.
 */
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
    env.ROBOTICK_PROJECT_DIR
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
  const proc = managedProcess;
  if (!proc) {
    return;
  }

  try {
    await fetch(STOP_URL, { method: "POST" });
  } catch {
    // ignore
  }

  await new Promise<void>((resolve) => {
    const exitListener = () => {
      clearTimeout(forceKillTimeout);
      resolve();
    };
    const termTimer = setTimeout(() => {
      if (proc.exitCode === null && !proc.killed) {
        proc.kill("SIGTERM");
      }
    }, 200);
    const forceKillTimeout = setTimeout(() => {
      if (proc.exitCode === null && !proc.killed) {
        proc.kill("SIGKILL");
      }
    }, 3000);

    proc.once("exit", exitListener);

    const timeout = setTimeout(() => {
      clearTimeout(termTimer);
      clearTimeout(forceKillTimeout);
      proc.off("exit", exitListener);
      if (proc.exitCode === null && !proc.killed) {
        proc.kill("SIGKILL");
      }
      resolve();
    }, 5000);

    proc.once("exit", () => {
      clearTimeout(termTimer);
      clearTimeout(forceKillTimeout);
      clearTimeout(timeout);
    });
  });

  if (managedProcess === proc) {
    managedProcess = null;
  }
}
