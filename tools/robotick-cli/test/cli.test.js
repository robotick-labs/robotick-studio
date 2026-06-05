const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const cliEntry = path.resolve(__dirname, "../dist/index.js");
let testApi = null;

function writeExecutable(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, { mode: 0o755 });
}

function createFakeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "robotick-cli-test-"));
  fs.mkdirSync(path.join(root, "robotick", "robotick-studio"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "robotick.yaml"),
    [
      "schema_version: 1",
      "",
      "studio:",
      "  default_path: robotick/robotick-studio",
      "  default_mode: dev",
      "",
      "projects:",
      "  barr-e:",
      "    project_dir: robots/barr-e",
      "    launch_script: robots/barr-e/run-studio.sh",
      "",
    ].join("\n"),
  );

  writeExecutable(
    path.join(root, "robotick", "robotick-studio", "run-studio-dev.sh"),
    "#!/usr/bin/env bash\nset -euo pipefail\nsleep 30\n",
  );
  writeExecutable(
    path.join(root, "robots", "barr-e", "run-studio.sh"),
    "#!/usr/bin/env bash\nset -euo pipefail\nsleep 30\n",
  );

  return root;
}

function runCli(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry, ...args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function runShell(inputs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(inputs.join("\n") + "\n");
  });
}

test.before(async () => {
  await runCli(["--help"], { cwd: createFakeWorkspace() });
  testApi = require(cliEntry).__test__;
});

test("top-level ls presents contexts separately from actions", () => {
  const text = testApi.formatShellContext({ namespace: null, instanceName: null });
  assert.match(text, /Available here:/);
  assert.match(text, /Contexts:\n- studio\//);
  assert.match(text, /Actions:\n- ls\n- clear\n- help\n- exit/);
});

test("studio ls exposes open as the only enterable context", () => {
  const text = testApi.formatShellContext({ namespace: "studio", instanceName: null });
  assert.match(text, /Available in studio:/);
  assert.match(text, /Contexts:\n- open\//);
  assert.doesNotMatch(text, /project\[barr-e\]/);
});

test("bound open-session ls advertises quit as an action", () => {
  const text = testApi.formatShellContext({
    namespace: "studio",
    instanceName: "studio-12345",
  });
  assert.match(text, /Available in studio\/open:/);
  assert.match(text, /Actions:\n- projects\n- ls\n- clear\n- help\n- back\n- quit\n- exit/);
});

test("open without project launches empty Studio quietly", async () => {
  const workspace = createFakeWorkspace();
  const result = await runCli(["studio", "open"], { cwd: workspace });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Opening Robotick Studio\.\.\./);
  assert.match(result.stdout, /Studio launch started\./);

  const logsDir = path.join(workspace, ".robotick", "logs");
  const logs = fs.readdirSync(logsDir);
  assert.ok(logs.some((name) => name.startsWith("studio-open-empty-")));
});

test("open with project launches project quietly", async () => {
  const workspace = createFakeWorkspace();
  const result = await runCli(["studio", "open", "barr-e"], { cwd: workspace });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Opening Robotick Studio for barr-e\.\.\./);
  assert.match(result.stdout, /Studio launch started for barr-e\./);
});

test("back unwinds from open context to studio without leaving the CLI", () => {
  const next = testApi.stepBack({ namespace: "studio", instanceName: "studio-12345" });
  assert.deepEqual(next, { namespace: "studio", instanceName: null });
});

test("back unwinds from studio context to top level", () => {
  const next = testApi.stepBack({ namespace: "studio", instanceName: null });
  assert.deepEqual(next, { namespace: null, instanceName: null });
});

test("prompt renders the bound open-session path", () => {
  const prompt = testApi.getPrompt({ namespace: "studio", instanceName: "studio-12345" });
  assert.equal(prompt, "robotick:studio:open[studio-12345]> ");
});

test("quit/instance helpers understand the provisional studio pid format", () => {
  assert.equal(testApi.parseInstancePid("studio-12345"), 12345);
  assert.equal(testApi.parseInstancePid("barr-e"), null);
});
