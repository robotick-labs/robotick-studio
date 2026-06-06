import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

type ManifestProject = {
  project_dir: string;
  launch_script: string;
};

type Manifest = {
  schema_version: number;
  studio: {
    default_path: string;
    default_mode: string;
  };
  projects: Record<string, ManifestProject>;
};

type ShellNamespace = "studio" | null;
type ShellState = {
  namespace: ShellNamespace;
  instanceName: string | null;
};

type CommandResult = {
  exitCode: number;
  openedInstanceName?: string;
};

type OpenLaunchTarget =
  | {
      kind: "empty";
      label: string;
      launchScript: string;
      attach: boolean;
      forwardedArgs: string[];
    }
  | {
      kind: "project";
      label: string;
      launchScript: string;
      attach: boolean;
      forwardedArgs: string[];
    };

type InstanceRecord = {
  name: string;
  pid: number;
  mode: string;
  logPath: string | null;
  projectName: string | null;
  startedAt: string;
};

class CliError extends Error {}

async function main(): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();
  const args = process.argv.slice(2);

  if (args.length === 0) {
    await startInteractiveShell(workspaceRoot);
    return;
  }

  if (isHelpFlag(args[0])) {
    printTopLevelHelp();
    return;
  }

  const result = await runCommand(workspaceRoot, args);
  process.exit(result.exitCode);
}

async function startInteractiveShell(workspaceRoot: string): Promise<void> {
  process.stdout.write(
    [
      "Welcome to Robotick™",
      "Type 'help' for commands or 'exit' to leave.",
      "",
    ].join("\n"),
  );

  const rl = readline.createInterface({
    input,
    output,
    terminal: Boolean(input.isTTY && output.isTTY),
  });

  try {
    const state: ShellState = { namespace: null, instanceName: null };

    while (true) {
      const staleMessage = reconcileBoundInstance(workspaceRoot, state);
      if (staleMessage) {
        process.stdout.write(`${staleMessage}\n`);
      }

      const rawLine = await rl.question(getPrompt(state));
      const line = rawLine.trim();
      if (line === "") continue;

      if (line === "exit") {
        return;
      }

      if (line === "help") {
        printShellHelp(state);
        continue;
      }

      if (line === "ls") {
        listShellContext(state, workspaceRoot);
        continue;
      }

      if (line === "clear") {
        clearScreen();
        continue;
      }

      if (line === "back") {
        if (state.namespace === null && state.instanceName === null) {
          process.stdout.write("Already at top level.\n");
        } else {
          const nextState = stepBack(state);
          state.namespace = nextState.namespace;
          state.instanceName = nextState.instanceName;
        }
        continue;
      }

      if (line === "quit") {
        if (state.namespace === "studio" && state.instanceName !== null) {
          const result = await quitStudioInstance(workspaceRoot, state.instanceName);
          process.stdout.write(`${result.message}\n`);
          if (result.accepted) {
            state.instanceName = null;
          }
        } else {
          process.stdout.write("No open Studio instance is currently bound.\n");
        }
        continue;
      }

      if (line === "studio" && state.namespace === null) {
        state.namespace = "studio";
        continue;
      }

      try {
        const tokens = tokenize(line);
        if (tokens[0] === "cd") {
          applyCd(workspaceRoot, state, tokens.slice(1));
          continue;
        }

        if (state.namespace === "studio" && state.instanceName === null && tokens[0] === "open") {
          const result = await runStudioCreateCommand(workspaceRoot, tokens.slice(1));
          bindOpenedInstanceToState(state, result);
          continue;
        }

        if (state.namespace !== null) {
          await runCommand(workspaceRoot, [state.namespace, ...tokens]);
        } else {
          await runCommand(workspaceRoot, tokens);
        }
      } catch (error) {
        reportError(error);
      }
    }
  } finally {
    rl.close();
  }
}

function getPrompt(state: ShellState): string {
  if (state.namespace === null) {
    return "robotick> ";
  }

  if (state.namespace === "studio" && state.instanceName !== null) {
    return `robotick:studio:${state.instanceName}> `;
  }

  return `robotick:${state.namespace}> `;
}

function printShellHelp(state: ShellState): void {
  process.stdout.write(formatShellHelp(state));
}

function formatShellHelp(state: ShellState): string {
  if (state.namespace === null) {
    return [
      "Top-level shell commands:",
      "  ls       List available namespaces and shell commands",
      "  studio   Enter the Studio command context",
      "  cd       Enter a context",
      "  clear    Clear the terminal",
      "  help     Show this help",
      "  exit     Leave Robotick",
      "",
    ].join("\n");
  }

  const currentContext =
    state.namespace === "studio" && state.instanceName !== null
      ? `studio/${state.instanceName}`
      : state.namespace;

  return [
    `Current context: ${currentContext}`,
    "  ls       List commands in the current context",
    "  cd       Enter a child context",
    "  clear    Clear the terminal",
    "  help     Show context help",
    "  back     Return to the parent shell context",
    ...(state.namespace === "studio" && state.instanceName !== null
      ? ["  quit     Close the current Studio instance"]
      : []),
    "  exit     Leave Robotick",
    "",
    ...(state.namespace === "studio" ? [getStudioHelpText()] : []),
  ].join("\n");
}

function listShellContext(state: ShellState, workspaceRoot: string): void {
  process.stdout.write(formatShellContext(state, workspaceRoot));
}

function formatShellContext(state: ShellState, workspaceRoot: string): string {
  if (state.namespace === null) {
    return [
      "Available here:",
      "Contexts:",
      "- studio/",
      "Actions:",
      "- ls",
      "- cd",
      "- clear",
      "- help",
      "- exit",
      "",
    ].join("\n");
  }

  if (state.namespace === "studio" && state.instanceName !== null) {
    return [
      `Available in studio/${state.instanceName}:`,
      "Contexts:",
      "- none",
      "Actions:",
      "- projects",
      "- ls",
      "- cd",
      "- clear",
      "- help",
      "- back",
      "- quit",
      "- exit",
      "",
    ].join("\n");
  }

  const instances = listLiveInstances(workspaceRoot);
  return [
    "Available in studio:",
    "Contexts:",
    ...formatInstanceContexts(instances),
    "Actions:",
    "- projects",
    "- instances",
    "- create [project]",
    "- open [project]",
    "- ls",
    "- cd",
    "- clear",
    "- help",
    "- back",
    "- exit",
    "",
  ].join("\n");
}

function stepBack(state: ShellState): ShellState {
  if (state.instanceName !== null) {
    return { ...state, instanceName: null };
  }

  if (state.namespace !== null) {
    return { namespace: null, instanceName: null };
  }

  return { ...state };
}

function bindOpenedInstanceToState(state: ShellState, result: CommandResult): void {
  if (state.namespace === "studio" && state.instanceName === null && result.openedInstanceName) {
    state.instanceName = result.openedInstanceName;
  }
}

function applyCd(workspaceRoot: string, state: ShellState, args: string[]): void {
  if (args.length === 0) {
    throw new CliError("Usage: cd <context> or cd ..");
  }

  if (args.length === 1 && args[0] === "..") {
    const nextState = stepBack(state);
    state.namespace = nextState.namespace;
    state.instanceName = nextState.instanceName;
    return;
  }

  if (state.namespace === null) {
    if (args.length === 1 && args[0] === "studio") {
      state.namespace = "studio";
      return;
    }
    throw new CliError(`Unknown top-level context: ${args.join(" ")}`);
  }

  if (state.namespace === "studio" && state.instanceName === null) {
    if (args.length !== 1) {
      throw new CliError("Use 'cd <instance>' from the Studio context.");
    }
    const instanceName = normalizeInstanceSpecifier(args[0]);
    const instance = getLiveInstance(workspaceRoot, instanceName);
    if (!instance) {
      throw new CliError(`Unknown Studio instance: ${args[0]}`);
    }
    state.instanceName = instance.name;
    return;
  }

  throw new CliError(`No child contexts are currently available for ${getPrompt(state).trim()}`);
}

function clearScreen(): void {
  process.stdout.write("\x1bc");
}

async function runCommand(
  workspaceRoot: string,
  args: string[],
): Promise<CommandResult> {
  const [namespace, ...rest] = args;
  if (namespace !== "studio") {
    throw new CliError(`Unknown namespace: ${namespace}`);
  }

  return runStudioCommand(workspaceRoot, rest);
}

function tokenize(line: string): string[] {
  return line.match(/"[^"]*"|'[^']*'|[^\s]+/g)?.map(stripQuotes) ?? [];
}

function stripQuotes(token: string): string {
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1);
  }

  return token;
}

async function runStudioCommand(
  workspaceRoot: string,
  args: string[],
): Promise<CommandResult> {
  if (args.length === 0 || isHelpFlag(args[0])) {
    printStudioHelp();
    return { exitCode: 0 };
  }

  const manifest = loadManifest(workspaceRoot);
  const [command, ...rest] = args;

  switch (command) {
    case "projects":
      handleProjectsCommand(manifest, rest);
      return { exitCode: 0 };
    case "instances":
      handleInstancesCommand(workspaceRoot, rest);
      return { exitCode: 0 };
    case "create":
      return runStudioCreateCommand(workspaceRoot, rest);
    case "open":
      return handleOpenCommand(workspaceRoot, rest);
    default:
      return runStudioInstanceCommand(workspaceRoot, command, rest);
  }
}

function runStudioInstanceCommand(
  workspaceRoot: string,
  instanceToken: string,
  args: string[],
): Promise<CommandResult> {
  const instanceName = normalizeInstanceSpecifier(instanceToken);
  const instance = getLiveInstance(workspaceRoot, instanceName);
  if (!instance) {
    throw new CliError(`Unknown studio command or instance: ${instanceToken}`);
  }

  const [command, ...rest] = args;
  if (!command || isHelpFlag(command)) {
    printInstanceHelp(instance.name);
    return Promise.resolve({ exitCode: 0 });
  }

  switch (command) {
    case "quit":
      return handleInstanceQuit(workspaceRoot, instance.name, rest);
    default:
      throw new CliError(`Unknown instance command for ${instance.name}: ${command}`);
  }
}

function handleProjectsCommand(manifest: Manifest, args: string[]): void {
  if (args.some(isHelpFlag)) {
    printProjectsHelp();
    return;
  }

  const json = args.includes("--json");
  const unknownArgs = args.filter((arg) => arg !== "--json");
  if (unknownArgs.length > 0) {
    throw new CliError(`Unknown argument for 'projects': ${unknownArgs[0]}`);
  }

  const projects = Object.entries(manifest.projects).map(([name, project]) => ({
    name,
    project_dir: project.project_dir,
    launch_script: project.launch_script,
  }));

  if (json) {
    process.stdout.write(`${JSON.stringify({ projects }, null, 2)}\n`);
    return;
  }

  process.stdout.write("Registered Robotick Studio projects:\n");
  for (const project of projects) {
    process.stdout.write(`- ${project.name}: ${project.project_dir}\n`);
  }
}

function handleInstancesCommand(workspaceRoot: string, args: string[]): void {
  if (args.some(isHelpFlag)) {
    printInstancesHelp();
    return;
  }

  const json = args.includes("--json");
  const unknownArgs = args.filter((arg) => arg !== "--json");
  if (unknownArgs.length > 0) {
    throw new CliError(`Unknown argument for 'instances': ${unknownArgs[0]}`);
  }

  const instances = listLiveInstances(workspaceRoot);
  if (json) {
    process.stdout.write(`${JSON.stringify({ instances }, null, 2)}\n`);
    return;
  }

  process.stdout.write("Open Robotick Studio instances:\n");
  if (instances.length === 0) {
    process.stdout.write("- none\n");
    return;
  }

  for (const instance of instances) {
    const projectSuffix = instance.projectName ? ` (${instance.projectName})` : "";
    process.stdout.write(`- ${instance.name}${projectSuffix}\n`);
  }
}

async function handleInstanceQuit(
  workspaceRoot: string,
  instanceName: string,
  args: string[],
): Promise<CommandResult> {
  if (args.some(isHelpFlag)) {
    printInstanceQuitHelp(instanceName);
    return { exitCode: 0 };
  }

  if (args.length > 0) {
    throw new CliError(`Unknown argument for '${instanceName} quit': ${args[0]}`);
  }

  const result = await quitStudioInstance(workspaceRoot, instanceName);
  process.stdout.write(`${result.message}\n`);
  return { exitCode: result.accepted ? 0 : 1 };
}

async function runStudioCreateCommand(
  workspaceRoot: string,
  args: string[],
): Promise<CommandResult> {
  const manifest = loadManifest(workspaceRoot);
  return handleCreateCommand(workspaceRoot, manifest, args);
}

async function handleCreateCommand(
  workspaceRoot: string,
  manifest: Manifest,
  args: string[],
): Promise<CommandResult> {
  if (args.some(isHelpFlag)) {
    printCreateHelp();
    return { exitCode: 0 };
  }

  const launchTarget = resolveOpenLaunchTarget(workspaceRoot, manifest, args, "create");
  return await launchStudioTarget(workspaceRoot, manifest, launchTarget);
}

async function handleOpenCommand(
  workspaceRoot: string,
  args: string[],
): Promise<CommandResult> {
  if (args.some(isHelpFlag)) {
    printOpenHelp();
    return { exitCode: 0 };
  }

  return runStudioCreateCommand(workspaceRoot, args);
}

function resolveOpenLaunchTarget(
  workspaceRoot: string,
  manifest: Manifest,
  args: string[],
  commandName = "open",
): OpenLaunchTarget {
  let attach = false;
  const forwardedArgs: string[] = [];
  let projectName: string | null = null;

  for (const arg of args) {
    if (arg === "--attach") {
      attach = true;
      continue;
    }

    if (arg.startsWith("--") && arg !== "--") {
      throw new CliError(`Unknown option for '${commandName}': ${arg}`);
    }

    if (projectName === null) {
      projectName = arg;
    } else {
      forwardedArgs.push(arg);
    }
  }

  if (projectName === null) {
    return {
      kind: "empty",
      label: "Robotick Studio",
      launchScript: resolveStudioRunnerPath(workspaceRoot, manifest),
      attach,
      forwardedArgs,
    };
  }

  const project = manifest.projects[projectName];
  if (!project) {
    const names = Object.keys(manifest.projects).sort().join(", ");
    throw new CliError(`Unknown project: ${projectName}. Registered projects: ${names}`);
  }

  const launchScript = path.resolve(workspaceRoot, project.launch_script);
  if (!fs.existsSync(launchScript)) {
    throw new CliError(`Launch script not found: ${launchScript}`);
  }

  return {
    kind: "project",
    label: projectName,
    launchScript,
    attach,
    forwardedArgs,
  };
}

async function launchStudioTarget(
  workspaceRoot: string,
  manifest: Manifest,
  target: OpenLaunchTarget,
): Promise<CommandResult> {
  const env = await createStudioLaunchEnv(workspaceRoot, manifest);

  if (!target.attach) {
    return await launchQuietStudio(
      workspaceRoot,
      target.label,
      manifest,
      target.launchScript,
      target.forwardedArgs,
      env,
      target.kind === "project",
    );
  }

  return await launchAttachedStudio(
    workspaceRoot,
    target.label,
    manifest,
    target.launchScript,
    target.forwardedArgs,
    env,
    target.kind === "project",
  );
}

async function launchQuietStudio(
  workspaceRoot: string,
  label: string,
  manifest: Manifest,
  launchScript: string,
  forwardedArgs: string[],
  env: NodeJS.ProcessEnv,
  hasProject: boolean,
): Promise<CommandResult> {
  const logPath = createStudioLogPath(workspaceRoot, hasProject ? label : "empty");
  const logFd = fs.openSync(logPath, "a");

  process.stdout.write(
    hasProject
      ? `Opening Robotick Studio for ${label}...\n`
      : "Opening Robotick Studio...\n",
  );
  process.stdout.write(`Starting Studio in ${manifest.studio.default_mode} mode...\n`);
  process.stdout.write(`Logs: ${path.relative(workspaceRoot, logPath)}\n`);

  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(launchScript, forwardedArgs, {
      cwd: workspaceRoot,
      env,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });

    child.on("spawn", () => {
      child.unref();
      fs.closeSync(logFd);
      const pid = child.pid;
      const instanceName = pid === undefined ? null : createInstanceName(pid);
      if (instanceName && pid !== undefined) {
        writeInstanceRecord(workspaceRoot, {
          name: instanceName,
          pid,
          mode: manifest.studio.default_mode,
          logPath,
          projectName: hasProject ? label : null,
          startedAt: new Date().toISOString(),
        });
      }
      process.stdout.write(
        hasProject
          ? `Studio launch started for ${label}.\n`
          : "Studio launch started.\n",
      );
      if (instanceName) {
        process.stdout.write(`Instance: ${instanceName}/\n`);
      }
      resolve({
        exitCode: 0,
        openedInstanceName: instanceName ?? undefined,
      });
    });

    child.on("error", (error) => {
      fs.closeSync(logFd);
      reject(new CliError(`Failed to launch Studio: ${error.message}`));
    });
  });
}

async function launchAttachedStudio(
  workspaceRoot: string,
  label: string,
  _manifest: Manifest,
  launchScript: string,
  forwardedArgs: string[],
  env: NodeJS.ProcessEnv,
  hasProject: boolean,
): Promise<CommandResult> {
  process.stdout.write(
    hasProject
      ? `Opening Robotick Studio for ${label}...\n`
      : "Opening Robotick Studio...\n",
  );
  process.stdout.write(
    "Attaching to full Studio logs. Use this mode when you want raw dev/build output.\n",
  );

  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(launchScript, forwardedArgs, {
      cwd: workspaceRoot,
      env,
      stdio: "inherit",
    });

    child.on("spawn", () => {
      const instanceName = createInstanceName(child.pid);
      if (instanceName) {
        process.stdout.write(`Instance: ${instanceName}/\n`);
      }
    });

    child.on("error", (error) => {
      reject(new CliError(`Failed to launch Studio: ${error.message}`));
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }

      resolve({
        exitCode: code ?? 0,
        openedInstanceName: createInstanceName(child.pid),
      });
    });
  });
}

async function createStudioLaunchEnv(
  workspaceRoot: string,
  manifest: Manifest,
): Promise<NodeJS.ProcessEnv> {
  const remoteDebuggingPort =
    process.env.ROBOTICK_REMOTE_DEBUGGING_PORT ?? `${await findAvailablePort()}`;

  return {
    ...process.env,
    ROBOTICK_WORKSPACE_ROOT: workspaceRoot,
    ROBOTICK_STUDIO_MODE:
      process.env.ROBOTICK_STUDIO_MODE ?? manifest.studio.default_mode,
    ROBOTICK_STUDIO_DIR:
      process.env.ROBOTICK_STUDIO_DIR ??
      path.resolve(workspaceRoot, manifest.studio.default_path),
    ROBOTICK_REMOTE_DEBUGGING_PORT: remoteDebuggingPort,
  };
}

function resolveStudioRunnerPath(workspaceRoot: string, manifest: Manifest): string {
  const studioDir =
    process.env.ROBOTICK_STUDIO_DIR ??
    path.resolve(workspaceRoot, manifest.studio.default_path);
  const runnerName =
    (process.env.ROBOTICK_STUDIO_MODE ?? manifest.studio.default_mode) ===
    "production"
      ? "run-studio-production.sh"
      : "run-studio-dev.sh";
  const runner = path.join(studioDir, runnerName);
  if (!fs.existsSync(runner)) {
    throw new CliError(`Expected Studio runner at ${runner}`);
  }
  return runner;
}

function createInstanceName(pid: number | undefined): string | undefined {
  if (!pid) {
    return undefined;
  }
  return `studio-${pid}`;
}

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to allocate port")));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function parseInstancePid(instanceName: string): number | null {
  const match = instanceName.match(/^studio-(\d+)$/);
  if (!match) return null;
  const pid = Number(match[1]);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

async function quitStudioInstance(
  workspaceRoot: string,
  instanceName: string,
): Promise<{ accepted: boolean; message: string }> {
  const instance = getLiveInstance(workspaceRoot, instanceName);
  if (!instance) {
    removeInstanceRecord(workspaceRoot, instanceName);
    return {
      accepted: false,
      message: `Studio instance ${instanceName} is no longer running.`,
    };
  }

  const pid = parseInstancePid(instance.name);
  if (pid === null) {
    return {
      accepted: false,
      message: `Unable to quit ${instance.name}. Invalid instance pid.`,
    };
  }

  try {
    signalInstanceProcessTree(pid, "SIGTERM");
    const exited = await waitForInstanceExit(pid, 4000);
    if (exited) {
      removeInstanceRecord(workspaceRoot, instance.name);
      return {
        accepted: true,
        message: `Studio instance ${instance.name} closed.`,
      };
    }

    signalInstanceProcessTree(pid, "SIGKILL");
    const killed = await waitForInstanceExit(pid, 1500);
    if (killed) {
      removeInstanceRecord(workspaceRoot, instance.name);
      return {
        accepted: true,
        message: `Studio instance ${instance.name} force-closed after not exiting cleanly.`,
      };
    }

    return {
      accepted: false,
      message: `Unable to close ${instance.name}. It is still running after TERM and KILL attempts.`,
    };
  } catch {
    return {
      accepted: false,
      message: `Unable to quit ${instance.name}. It may already have exited.`,
    };
  }
}

function getInstancesDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".robotick", "instances");
}

function getInstanceRecordPath(workspaceRoot: string, instanceName: string): string {
  return path.join(getInstancesDir(workspaceRoot), `${instanceName}.json`);
}

function writeInstanceRecord(workspaceRoot: string, record: InstanceRecord): void {
  fs.mkdirSync(getInstancesDir(workspaceRoot), { recursive: true });
  fs.writeFileSync(
    getInstanceRecordPath(workspaceRoot, record.name),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );
}

function removeInstanceRecord(workspaceRoot: string, instanceName: string): void {
  const recordPath = getInstanceRecordPath(workspaceRoot, instanceName);
  if (fs.existsSync(recordPath)) {
    fs.unlinkSync(recordPath);
  }
}

function listLiveInstances(workspaceRoot: string): InstanceRecord[] {
  const instancesDir = getInstancesDir(workspaceRoot);
  if (!fs.existsSync(instancesDir)) {
    return [];
  }

  const instances: InstanceRecord[] = [];
  for (const entry of fs.readdirSync(instancesDir)) {
    if (!entry.endsWith(".json")) continue;
    const instanceName = entry.slice(0, -5);
    const instance = readInstanceRecord(workspaceRoot, instanceName);
    if (!instance) continue;
    if (!isInstanceAlive(instance)) {
      removeInstanceRecord(workspaceRoot, instance.name);
      continue;
    }
    instances.push(instance);
  }

  instances.sort((left, right) => left.name.localeCompare(right.name));
  return instances;
}

function getLiveInstance(workspaceRoot: string, instanceName: string): InstanceRecord | null {
  return listLiveInstances(workspaceRoot).find((instance) => instance.name === instanceName) ?? null;
}

function readInstanceRecord(workspaceRoot: string, instanceName: string): InstanceRecord | null {
  const recordPath = getInstanceRecordPath(workspaceRoot, instanceName);
  if (!fs.existsSync(recordPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(recordPath, "utf8")) as InstanceRecord;
    if (
      typeof parsed.name !== "string" ||
      typeof parsed.pid !== "number" ||
      typeof parsed.mode !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isInstanceAlive(instance: InstanceRecord): boolean {
  if (process.platform === "win32") {
    return isPidAlive(instance.pid);
  }

  return listUnixProcessGroupMembers(instance.pid).length > 0;
}

function signalInstanceProcessTree(pid: number, signal: NodeJS.Signals): void {
  if (process.platform === "win32") {
    process.kill(pid, signal);
    return;
  }

  process.kill(-pid, signal);
}

async function waitForInstanceExit(instancePid: number, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isInstancePidActive(instancePid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isInstancePidActive(instancePid);
}

function isInstancePidActive(instancePid: number): boolean {
  if (process.platform === "win32") {
    return isPidAlive(instancePid);
  }

  return listUnixProcessGroupMembers(instancePid).length > 0;
}

function listUnixProcessGroupMembers(processGroupId: number): number[] {
  const result = spawnSync("ps", ["-eo", "pid=,pgid="], {
    encoding: "utf-8",
  });
  if (result.status !== 0 || !result.stdout) {
    return isPidAlive(processGroupId) ? [processGroupId] : [];
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)$/);
      if (!match) {
        return null;
      }
      const pid = Number.parseInt(match[1], 10);
      const pgid = Number.parseInt(match[2], 10);
      if (Number.isNaN(pid) || Number.isNaN(pgid)) {
        return null;
      }
      return pgid === processGroupId ? pid : null;
    })
    .filter((pid): pid is number => pid !== null);
}

function normalizeInstanceSpecifier(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function reconcileBoundInstance(workspaceRoot: string, state: ShellState): string | null {
  if (state.namespace !== "studio" || state.instanceName === null) {
    return null;
  }

  if (getLiveInstance(workspaceRoot, state.instanceName)) {
    return null;
  }

  const staleInstanceName = state.instanceName;
  state.instanceName = null;
  return `Studio instance ${staleInstanceName} closed.`;
}

function formatInstanceContexts(instances: InstanceRecord[]): string[] {
  if (instances.length === 0) {
    return ["- none"];
  }

  return instances.map((instance) => `- ${instance.name}/`);
}

function createStudioLogPath(workspaceRoot: string, projectName: string): string {
  const logsDir = path.join(workspaceRoot, ".robotick", "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:]/g, "-");
  return path.join(logsDir, `studio-open-${projectName}-${timestamp}.log`);
}

function loadManifest(workspaceRoot: string): Manifest {
  const manifestPath = path.join(workspaceRoot, "robotick.yaml");
  if (!fs.existsSync(manifestPath)) {
    throw new CliError(`Workspace manifest not found: ${manifestPath}`);
  }

  const raw = fs.readFileSync(manifestPath, "utf8");
  const parsed = parseSimpleYaml(raw) as Record<string, unknown>;
  return validateManifest(parsed, manifestPath);
}

function validateManifest(
  value: Record<string, unknown>,
  manifestPath: string,
): Manifest {
  const schemaVersion = expectNumber(value.schema_version, "schema_version", manifestPath);
  const studio = expectObject(value.studio, "studio", manifestPath);
  const projects = expectObject(value.projects, "projects", manifestPath);

  const manifestProjects: Record<string, ManifestProject> = {};
  for (const [name, projectValue] of Object.entries(projects)) {
    const project = expectObject(projectValue, `projects.${name}`, manifestPath);
    manifestProjects[name] = {
      project_dir: expectString(project.project_dir, `projects.${name}.project_dir`, manifestPath),
      launch_script: expectString(
        project.launch_script,
        `projects.${name}.launch_script`,
        manifestPath,
      ),
    };
  }

  return {
    schema_version: schemaVersion,
    studio: {
      default_path: expectString(studio.default_path, "studio.default_path", manifestPath),
      default_mode: expectString(studio.default_mode, "studio.default_mode", manifestPath),
    },
    projects: manifestProjects,
  };
}

function parseSimpleYaml(text: string): unknown {
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; value: Record<string, unknown> }> = [
    { indent: -1, value: root },
  ];

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    if (rawLine.trim() === "" || rawLine.trimStart().startsWith("#")) continue;
    if (rawLine.includes("\t")) {
      throw new CliError(`Tabs are not supported in robotick.yaml (line ${lineNumber})`);
    }

    const match = rawLine.match(/^(\s*)([^:#][^:]*):(.*)$/);
    if (!match) {
      throw new CliError(`Unsupported robotick.yaml syntax on line ${lineNumber}: ${rawLine}`);
    }

    const indent = match[1].length;
    const key = match[2].trim();
    const rawValue = match[3].trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].value;
    if (rawValue === "") {
      const child: Record<string, unknown> = {};
      parent[key] = child;
      stack.push({ indent, value: child });
      continue;
    }

    parent[key] = parseScalar(rawValue);
  }

  return root;
}

function parseScalar(value: string): unknown {
  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function expectObject(
  value: unknown,
  label: string,
  manifestPath: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CliError(`Expected ${label} to be an object in ${manifestPath}`);
  }
  return value as Record<string, unknown>;
}

function expectString(value: unknown, label: string, manifestPath: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CliError(`Expected ${label} to be a non-empty string in ${manifestPath}`);
  }
  return value;
}

function expectNumber(value: unknown, label: string, manifestPath: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new CliError(`Expected ${label} to be a number in ${manifestPath}`);
  }
  return value;
}

function getWorkspaceRoot(): string {
  const workspaceRoot = process.env.ROBOTICK_WORKSPACE_ROOT;
  return workspaceRoot && workspaceRoot.length > 0 ? workspaceRoot : process.cwd();
}

function isHelpFlag(value: string): boolean {
  return value === "--help" || value === "-h" || value === "help";
}

function printTopLevelHelp(): void {
  process.stdout.write(
    [
      "Usage:",
      "  robotick",
      "  robotick studio <command>",
      "",
      "Interactive mode:",
      "  Running 'robotick' on its own opens a simple command shell.",
      "  Type 'ls' to list commands in the current context.",
      "  Type 'studio' to enter the Studio command context.",
      "",
      "Namespaces:",
      "  studio   Open and inspect Robotick Studio projects in this workspace",
      "",
      "Run 'robotick studio --help' for Studio commands.",
      "",
    ].join("\n"),
  );
}

function printStudioHelp(): void {
  process.stdout.write(getStudioHelpText());
}

function getStudioHelpText(): string {
  return [
    "Usage:",
    "  robotick studio projects [--json]",
    "  robotick studio instances [--json]",
    "  robotick studio create [project] [--attach] [studio-args...]",
    "  robotick studio open [project] [--attach] [studio-args...]",
    "  robotick studio <instance> quit",
    "",
    "Commands:",
    "  projects   List registered Studio projects from robotick.yaml",
    "  instances  List live Studio instances tracked in .robotick/instances",
    "  create     Primitive instance creation without changing shell context",
    "  open       Convenience launch; in the immediate shell it creates then enters the instance",
    "",
  ].join("\n");
}

function printProjectsHelp(): void {
  process.stdout.write(
    [
      "Usage:",
      "  robotick studio projects [--json]",
      "",
      "Options:",
      "  --json   Print the registered project list as JSON",
      "",
    ].join("\n"),
  );
}

function printInstancesHelp(): void {
  process.stdout.write(
    [
      "Usage:",
      "  robotick studio instances [--json]",
      "",
      "Options:",
      "  --json   Print the live Studio instance list as JSON",
      "",
    ].join("\n"),
  );
}

function printCreateHelp(): void {
  process.stdout.write(
    [
      "Usage:",
      "  robotick studio create [project] [--attach] [studio-args...]",
      "",
      "Description:",
      "  Create a new Robotick Studio instance without changing shell context.",
      "  By default the launch is quiet and writes logs to .robotick/logs/.",
      "  Use --attach to inherit the full Studio log stream.",
      "  Any extra arguments are forwarded to the project launch script when a project is given.",
      "",
    ].join("\n"),
  );
}

function printOpenHelp(): void {
  process.stdout.write(
    [
      "Usage:",
      "  robotick studio open [project] [--attach] [studio-args...]",
      "",
      "Description:",
      "  Convenience launch command. In the immediate shell it creates a new",
      "  Robotick Studio instance and enters it immediately.",
      "  In one-shot CLI usage it behaves like the create primitive.",
      "  By default the launch is quiet and writes logs to .robotick/logs/.",
      "  Use --attach to inherit the full Studio log stream.",
      "  Any extra arguments are forwarded to the project launch script when a project is given.",
      "",
    ].join("\n"),
  );
}

function printInstanceHelp(instanceName: string): void {
  process.stdout.write(
    [
      "Usage:",
      `  robotick studio ${instanceName} quit`,
      "",
      "Commands:",
      "  quit   Close this Studio instance",
      "",
    ].join("\n"),
  );
}

function printInstanceQuitHelp(instanceName: string): void {
  process.stdout.write(
    [
      "Usage:",
      `  robotick studio ${instanceName} quit`,
      "",
      "Description:",
      "  Request shutdown of the targeted Studio instance.",
      "",
    ].join("\n"),
  );
}

function reportError(error: unknown): void {
  if (error instanceof CliError) {
    process.stderr.write(`${error.message}\n`);
    return;
  }
  if (error instanceof Error) {
    process.stderr.write(`${error.message}\n`);
    return;
  }
  process.stderr.write("Unknown error\n");
}

if (require.main === module) {
  void main().catch((error) => {
    reportError(error);
    process.exit(1);
  });
}

export const __test__ = {
  applyCd,
  bindOpenedInstanceToState,
  createInstanceName,
  formatInstanceContexts,
  formatShellContext,
  formatShellHelp,
  getPrompt,
  getStudioHelpText,
  listLiveInstances,
  normalizeInstanceSpecifier,
  parseInstancePid,
  reconcileBoundInstance,
  stepBack,
};
