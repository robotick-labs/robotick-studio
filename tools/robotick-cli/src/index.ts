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

  const exitCode = await runCommand(workspaceRoot, args);
  process.exit(exitCode);
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
    let currentNamespace: ShellNamespace = null;

    while (true) {
      const rawLine = await rl.question(getPrompt(currentNamespace));
      const line = rawLine.trim();
      if (line === "") {
        continue;
      }

      if (line === "exit" || line === "quit") {
        return;
      }

      if (line === "help") {
        printShellHelp(currentNamespace);
        continue;
      }

      if (line === "ls") {
        listShellContext(currentNamespace);
        continue;
      }

      if (line === "clear") {
        clearScreen();
        continue;
      }

      if (line === "back") {
        if (currentNamespace === null) {
          process.stdout.write("Already at top level.\n");
        } else {
          currentNamespace = null;
        }
        continue;
      }

      if (line === "studio" && currentNamespace === null) {
        currentNamespace = "studio";
        continue;
      }

      try {
        const tokens = tokenize(line);
        if (currentNamespace !== null) {
          await runCommand(workspaceRoot, [currentNamespace, ...tokens]);
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

function getPrompt(currentNamespace: ShellNamespace): string {
  if (currentNamespace === null) {
    return "robotick> ";
  }

  return `robotick:${currentNamespace}> `;
}

function printShellHelp(currentNamespace: ShellNamespace): void {
  if (currentNamespace === null) {
    process.stdout.write(
      [
        "Top-level shell commands:",
        "  ls       List available namespaces and shell commands",
        "  studio   Enter the Studio command context",
        "  clear    Clear the terminal",
        "  help     Show this help",
        "  exit     Leave Robotick",
        "",
      ].join("\n"),
    );
    return;
  }

  process.stdout.write(
    [
      `Current context: ${currentNamespace}`,
      "  ls       List commands in the current context",
      "  clear    Clear the terminal",
      "  help     Show context help",
      "  back     Return to the top-level shell",
      "  exit     Leave Robotick",
      "",
    ].join("\n"),
  );

  if (currentNamespace === "studio") {
    printStudioHelp();
  }
}

function listShellContext(currentNamespace: ShellNamespace): void {
  if (currentNamespace === null) {
    process.stdout.write(
      [
        "Available here:",
        "- studio",
        "- ls",
        "- clear",
        "- help",
        "- exit",
        "",
      ].join("\n"),
    );
    return;
  }

  if (currentNamespace === "studio") {
    process.stdout.write(
      [
        "Available in studio:",
        "- projects",
        "- open <project>",
        "- ls",
        "- clear",
        "- help",
        "- back",
        "- exit",
        "",
      ].join("\n"),
    );
  }
}

function clearScreen(): void {
  process.stdout.write("\x1bc");
}

async function runCommand(workspaceRoot: string, args: string[]): Promise<number> {
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

async function runStudioCommand(workspaceRoot: string, args: string[]): Promise<number> {
  if (args.length === 0 || isHelpFlag(args[0])) {
    printStudioHelp();
    return 0;
  }

  const manifest = loadManifest(workspaceRoot);
  const [command, ...rest] = args;

  switch (command) {
    case "projects":
      handleProjectsCommand(manifest, rest);
      return 0;
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
): Promise<number> {
  if (args.length === 0 || isHelpFlag(args[0])) {
    printOpenHelp();
    return Promise.resolve(0);
  }

  const [projectName, ...forwardedArgs] = args;
  const project = manifest.projects[projectName];
  if (!project) {
    const names = Object.keys(manifest.projects).sort().join(", ");
    throw new CliError(`Unknown project: ${projectName}. Registered projects: ${names}`);
  }

  const launchScript = path.resolve(workspaceRoot, project.launch_script);
  if (!fs.existsSync(launchScript)) {
    throw new CliError(`Launch script not found: ${launchScript}`);
  }

  return new Promise<number>((resolve, reject) => {
    const child = spawn(launchScript, forwardedArgs, {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        ROBOTICK_WORKSPACE_ROOT: workspaceRoot,
        ROBOTICK_STUDIO_MODE:
          process.env.ROBOTICK_STUDIO_MODE ?? manifest.studio.default_mode,
        ROBOTICK_STUDIO_DIR:
          process.env.ROBOTICK_STUDIO_DIR ??
          path.resolve(workspaceRoot, manifest.studio.default_path),
      },
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

      resolve(code ?? 0);
    });
  });
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
  process.stdout.write(
    [
      "Usage:",
      "  robotick studio projects [--json]",
      "  robotick studio open <project> [studio-args...]",
      "",
      "Commands:",
      "  projects   List registered Studio projects from robotick.yaml",
      "  open       Launch a registered project in Robotick Studio",
      "",
    ].join("\n"),
  );
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
      "  robotick studio open <project> [studio-args...]",
      "",
      "Description:",
      "  Launch a registered project using its workspace launch script.",
      "  Any extra arguments are forwarded to that launch script.",
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

void main().catch((error) => {
  reportError(error);
  process.exit(1);
});
