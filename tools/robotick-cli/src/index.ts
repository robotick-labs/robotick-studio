import { spawn } from "node:child_process";
import * as fs from "node:fs";
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

class CliError extends Error {}
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
      const rawLine = await rl.question(getPrompt(state));
      const line = rawLine.trim();
      if (line === "") {
        continue;
      }

      if (line === "exit") {
        return;
      }

      if (line === "quit") {
        if (state.namespace === "studio" && state.instanceName !== null) {
          if (quitBoundStudioInstance(state.instanceName)) {
            process.stdout.write(`Quit requested for ${state.instanceName}.\n`);
            state.instanceName = null;
          } else {
            process.stdout.write(
              `Unable to quit ${state.instanceName}. It may already have exited.\n`,
            );
            state.instanceName = null;
          }
          continue;
        }

        process.stdout.write("No open Studio session is currently bound.\n");
        continue;
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
        if (state.instanceName === null && state.namespace === null) {
          process.stdout.write("Already at top level.\n");
        } else {
          const nextState = stepBack(state);
          state.namespace = nextState.namespace;
          state.instanceName = nextState.instanceName;
        }
        continue;
      }

      if (line === "studio" && state.namespace === null) {
        state.namespace = "studio";
        state.instanceName = null;
        continue;
      }

      try {
        const tokens = tokenize(line);
        if (
          state.namespace === "studio" &&
          state.instanceName !== null &&
          tokens[0] === "open"
        ) {
          process.stdout.write(
            "Already bound to a Studio instance. Use 'back' before opening another one.\n",
          );
          continue;
        }

        if (state.namespace !== null) {
          const result = await runCommand(workspaceRoot, [state.namespace, ...tokens]);
          if (state.namespace === "studio" && result.openedInstanceName) {
            state.instanceName = result.openedInstanceName;
          }
        } else {
          const result = await runCommand(workspaceRoot, tokens);
          if (tokens[0] === "studio" && result.openedInstanceName) {
            state.namespace = "studio";
            state.instanceName = result.openedInstanceName;
          }
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

  if (state.namespace === "studio" && state.instanceName) {
    return `robotick:studio:open[${state.instanceName}]> `;
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
      "  clear    Clear the terminal",
      "  help     Show this help",
      "  exit     Leave Robotick",
      "",
    ].join("\n");
  }

  const currentContext =
    state.namespace === "studio" && state.instanceName !== null
      ? "studio/open"
      : state.namespace;

  return [
    `Current context: ${currentContext}`,
    "  ls       List commands in the current context",
    "  clear    Clear the terminal",
    "  help     Show context help",
    "  back     Return to the parent shell context",
    ...(state.namespace === "studio" && state.instanceName !== null
      ? ["  quit     Close the current open Studio session"]
      : []),
    "  exit     Leave Robotick",
    "",
    ...(state.namespace === "studio" ? [getStudioHelpText()] : []),
  ].join("\n");
}

function listShellContext(state: ShellState, _workspaceRoot: string): void {
  process.stdout.write(formatShellContext(state));
}

function formatShellContext(state: ShellState): string {
  if (state.namespace === null) {
    return [
      "Available here:",
      "Contexts:",
      "- studio/",
      "Actions:",
      "- ls",
      "- clear",
      "- help",
      "- exit",
      "",
    ].join("\n");
  }

  if (state.namespace === "studio" && state.instanceName !== null) {
    return [
      "Available in studio/open:",
      "Contexts:",
      "- none",
      "Actions:",
      "- projects",
      "- ls",
      "- clear",
      "- help",
      "- back",
      "- quit",
      "- exit",
      "",
    ].join("\n");
  }

  if (state.namespace === "studio") {
    return [
      "Available in studio:",
      "Contexts:",
      "- open/",
      "Actions:",
      "- projects",
      "- open [project]",
      "- ls",
      "- clear",
      "- help",
      "- back",
      "- exit",
      "",
    ].join("\n");
  }

  return "";
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
    case "open":
      return handleOpenCommand(workspaceRoot, manifest, rest);
    default:
      throw new CliError(`Unknown studio command: ${command}`);
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

function handleOpenCommand(
  workspaceRoot: string,
  manifest: Manifest,
  args: string[],
): Promise<CommandResult> {
  if (args.some(isHelpFlag)) {
    printOpenHelp();
    return Promise.resolve({ exitCode: 0 });
  }

  const launchTarget = resolveOpenLaunchTarget(workspaceRoot, manifest, args);
  return launchStudioTarget(workspaceRoot, manifest, launchTarget);
}

function resolveOpenLaunchTarget(
  workspaceRoot: string,
  manifest: Manifest,
  args: string[],
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
      throw new CliError(`Unknown option for 'open': ${arg}`);
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

function launchStudioTarget(
  workspaceRoot: string,
  manifest: Manifest,
  target: OpenLaunchTarget,
): Promise<CommandResult> {
  const env = createStudioLaunchEnv(workspaceRoot, manifest);

  if (target.kind === "project") {
    if (!target.attach) {
      return launchQuietStudio(
        workspaceRoot,
        target.label,
        manifest,
        target.launchScript,
        target.forwardedArgs,
        env,
        true,
      );
    }
    return launchAttachedStudio(
      workspaceRoot,
      target.label,
      manifest,
      target.launchScript,
      target.forwardedArgs,
      env,
      true,
    );
  }

  if (!target.attach) {
    return launchQuietStudio(
      workspaceRoot,
      target.label,
      manifest,
      target.launchScript,
      target.forwardedArgs,
      env,
      false,
    );
  }

  return launchAttachedStudio(
    workspaceRoot,
    target.label,
    manifest,
    target.launchScript,
    target.forwardedArgs,
    env,
    false,
  );
}

function launchQuietStudio(
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
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(launchScript, forwardedArgs, {
      cwd: workspaceRoot,
      env,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });

    child.on("spawn", () => {
      child.unref();
      fs.closeSync(logFd);
      process.stdout.write(
        hasProject
          ? `Studio launch started for ${label}.\n`
          : "Studio launch started.\n",
      );
      resolve({
        exitCode: 0,
        openedInstanceName: createInstanceName(child.pid),
      });
    });

    child.on("error", (error) => {
      fs.closeSync(logFd);
      reject(new CliError(`Failed to launch Studio: ${error.message}`));
    });
  });
}

function launchAttachedStudio(
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
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(launchScript, forwardedArgs, {
      cwd: workspaceRoot,
      env,
      stdio: "inherit",
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

function createStudioLaunchEnv(
  workspaceRoot: string,
  manifest: Manifest,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ROBOTICK_WORKSPACE_ROOT: workspaceRoot,
    ROBOTICK_STUDIO_MODE:
      process.env.ROBOTICK_STUDIO_MODE ?? manifest.studio.default_mode,
    ROBOTICK_STUDIO_DIR:
      process.env.ROBOTICK_STUDIO_DIR ??
      path.resolve(workspaceRoot, manifest.studio.default_path),
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

function parseInstancePid(instanceName: string): number | null {
  const match = instanceName.match(/^studio-(\d+)$/);
  if (!match) {
    return null;
  }

  const pid = Number(match[1]);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function quitBoundStudioInstance(instanceName: string): boolean {
  const pid = parseInstancePid(instanceName);
  if (pid === null) {
    return false;
  }

  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
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
  const schemaVersion = expectNumber(
    value.schema_version,
    "schema_version",
    manifestPath,
  );
  const studio = expectObject(value.studio, "studio", manifestPath);
  const projects = expectObject(value.projects, "projects", manifestPath);

  const manifestProjects: Record<string, ManifestProject> = {};
  for (const [name, projectValue] of Object.entries(projects)) {
    const project = expectObject(projectValue, `projects.${name}`, manifestPath);
    manifestProjects[name] = {
      project_dir: expectString(
        project.project_dir,
        `projects.${name}.project_dir`,
        manifestPath,
      ),
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
      default_path: expectString(
        studio.default_path,
        "studio.default_path",
        manifestPath,
      ),
      default_mode: expectString(
        studio.default_mode,
        "studio.default_mode",
        manifestPath,
      ),
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
    if (rawLine.trim() === "" || rawLine.trimStart().startsWith("#")) {
      continue;
    }

    if (rawLine.includes("\t")) {
      throw new CliError(`Tabs are not supported in robotick.yaml (line ${lineNumber})`);
    }

    const match = rawLine.match(/^(\s*)([^:#][^:]*):(.*)$/);
    if (!match) {
      throw new CliError(
        `Unsupported robotick.yaml syntax on line ${lineNumber}: ${rawLine}`,
      );
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

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

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
  if (workspaceRoot && workspaceRoot.length > 0) {
    return workspaceRoot;
  }

  return process.cwd();
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
    "  robotick studio open [project] [--attach] [studio-args...]",
    "",
    "Commands:",
    "  projects   List registered Studio projects from robotick.yaml",
    "  open       Launch empty Studio, or a registered project when given",
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

function printOpenHelp(): void {
  process.stdout.write(
    [
      "Usage:",
      "  robotick studio open [project] [--attach] [studio-args...]",
      "",
      "Description:",
      "  Launch empty Robotick Studio, or a registered project when given.",
      "  By default the launch is quiet and writes logs to .robotick/logs/.",
      "  Use --attach to inherit the full Studio log stream.",
      "  Any extra arguments are forwarded to the project launch script when a project is given.",
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
  formatShellContext,
  formatShellHelp,
  getPrompt,
  getStudioHelpText,
  parseInstancePid,
  stepBack,
};
