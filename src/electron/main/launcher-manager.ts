import { spawn, spawnSync, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";

const WORKSPACE_ROOT =
  process.env.ROBOTICK_WORKSPACE_ROOT ??
  process.cwd();
const LAUNCHER_RELATIVE_PATH = process.env.ROBOTICK_LAUNCHER_DIR ?? "tools/robotick-launcher";
const LAUNCHER_DIR = path.join(WORKSPACE_ROOT, LAUNCHER_RELATIVE_PATH);
const VENV_DIR = path.join(WORKSPACE_ROOT, ".studio", ".venv");
const VENV_BIN = path.join(VENV_DIR, "bin");
const PYTHON_BIN = process.env.ROBOTICK_PYTHON ?? "python3";
const STATUS_URL = "http://localhost:7081/launcher/status";
const STOP_URL = "http://localhost:7081/launcher/stop";

let managedProcess: ChildProcess | null = null;

const launcherBin = () => path.join(VENV_BIN, "robotick-launcher");

function pathExists(target: string) {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

function ensureVenv() {
  if (pathExists(path.join(VENV_BIN, "python"))) {
    return;
  }
  spawnSync(PYTHON_BIN, ["-m", "venv", VENV_DIR], {
    cwd: WORKSPACE_ROOT,
    stdio: "inherit",
  });
}

function installLauncherDependencies() {
  const python = path.join(VENV_BIN, "python");
  spawnSync(
    python,
    ["-m", "pip", "install", "--upgrade", "pip", "wheel", "setuptools"],
    { cwd: WORKSPACE_ROOT, stdio: "inherit" }
  );
  spawnSync(
    python,
    ["-m", "pip", "install", "-e", `${LAUNCHER_DIR}[dev]`],
    {
      cwd: WORKSPACE_ROOT,
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

export async function ensureLauncherReady() {
  if (await isLauncherResponding()) {
    return;
  }

  ensureVenv();
  installLauncherDependencies();

  const bin = launcherBin();
  console.log(`[Launcher] Workspace root: ${WORKSPACE_ROOT}`);
  const env = {
    ...process.env,
    PATH: `${VENV_BIN}:${process.env.PATH ?? ""}`,
  };
  console.log(`[Launcher] Starting listener with cwd ${WORKSPACE_ROOT}`);
  managedProcess = spawn(bin, ["listen"], {
    cwd: WORKSPACE_ROOT,
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
