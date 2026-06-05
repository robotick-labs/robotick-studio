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

async function waitFor(condition, timeoutMs = 3000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for condition");
}

test.before(async () => {
  await runCli(["--help"], { cwd: createFakeWorkspace() });
  testApi = require(cliEntry).__test__;
});

test("top-level ls presents contexts separately from actions", () => {
  const text = testApi.formatShellContext({ namespace: null, sessionName: null }, createFakeWorkspace());
  assert.match(text, /Available here:/);
  assert.match(text, /Contexts:\n- studio\//);
  assert.match(text, /Actions:\n- ls\n- cd\n- clear\n- help\n- exit/);
});

test("studio ls exposes session folders as contexts and open as an action", async () => {
  const workspace = createFakeWorkspace();
  await runCli(["studio", "open"], { cwd: workspace });
  const text = testApi.formatShellContext({ namespace: "studio", sessionName: null }, workspace);
  assert.match(text, /Available in studio:/);
  assert.match(text, /Contexts:\n- studio-\d+\//);
  assert.match(text, /Actions:\n- projects\n- instances\n- create \[project\]\n- open \[project\]/);
});

test("bound session ls advertises quit as an action", () => {
  const text = testApi.formatShellContext({
    namespace: "studio",
    sessionName: "studio-12345",
  }, createFakeWorkspace());
  assert.match(text, /Available in studio\/studio-12345:/);
  assert.match(text, /Actions:\n- projects\n- ls\n- cd\n- clear\n- help\n- back\n- quit\n- exit/);
});

test("open without project launches empty Studio quietly", async () => {
  const workspace = createFakeWorkspace();
  const result = await runCli(["studio", "open"], { cwd: workspace });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Opening Robotick Studio\.\.\./);
  assert.match(result.stdout, /Studio launch started\./);
  assert.match(result.stdout, /Session: studio-\d+\//);

  const logsDir = path.join(workspace, ".robotick", "logs");
  const logs = fs.readdirSync(logsDir);
  assert.ok(logs.some((name) => name.startsWith("studio-open-empty-")));
});

test("create without project launches empty Studio quietly without changing the contract", async () => {
  const workspace = createFakeWorkspace();
  const result = await runCli(["studio", "create"], { cwd: workspace });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Opening Robotick Studio\.\.\./);
  assert.match(result.stdout, /Studio launch started\./);
  assert.match(result.stdout, /Session: studio-\d+\//);
});

test("open with project launches project quietly", async () => {
  const workspace = createFakeWorkspace();
  const result = await runCli(["studio", "open", "barr-e"], { cwd: workspace });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Opening Robotick Studio for barr-e\.\.\./);
  assert.match(result.stdout, /Studio launch started for barr-e\./);
  assert.match(result.stdout, /Session: studio-\d+\//);
});

test("instances lists live sessions created by open", async () => {
  const workspace = createFakeWorkspace();
  const opened = await runCli(["studio", "open"], { cwd: workspace });
  const sessionName = opened.stdout.match(/Session: (studio-\d+)\//)?.[1];

  assert.ok(sessionName);

  const listed = await runCli(["studio", "instances"], { cwd: workspace });
  assert.equal(listed.code, 0);
  assert.match(listed.stdout, new RegExp(`- ${sessionName}`));
});

test("one-shot quit closes a live session cleanly", async () => {
  const workspace = createFakeWorkspace();
  const opened = await runCli(["studio", "open"], { cwd: workspace });
  const sessionName = opened.stdout.match(/Session: (studio-\d+)\//)?.[1];

  assert.ok(sessionName);

  const quit = await runCli(["studio", sessionName, "quit"], { cwd: workspace });
  assert.equal(quit.code, 0);
  assert.match(
    quit.stdout,
    new RegExp(
      `Studio session ${sessionName} (closed\\.|force-closed after not exiting cleanly\\.)`,
    ),
  );

  await waitFor(() => !fs.existsSync(path.join(workspace, ".robotick", "instances", `${sessionName}.json`)));
});

test("cd enters a discovered session context", async () => {
  const workspace = createFakeWorkspace();
  const opened = await runCli(["studio", "open"], { cwd: workspace });
  const sessionName = opened.stdout.match(/Session: (studio-\d+)\//)?.[1];

  assert.ok(sessionName);

  const state = { namespace: "studio", sessionName: null };
  testApi.applyCd(workspace, state, [sessionName]);
  assert.deepEqual(state, { namespace: "studio", sessionName });
});

test("shell open composite binds a newly created session into context", () => {
  const state = { namespace: "studio", sessionName: null };
  testApi.bindOpenedSessionToState(state, { exitCode: 0, openedSessionName: "studio-12345" });
  assert.deepEqual(state, { namespace: "studio", sessionName: "studio-12345" });
});

test("shell create primitive does not bind when there is no opened session to enter", () => {
  const state = { namespace: "studio", sessionName: null };
  testApi.bindOpenedSessionToState(state, { exitCode: 0 });
  assert.deepEqual(state, { namespace: "studio", sessionName: null });
});

test("back unwinds from session context to studio without leaving the CLI", () => {
  const next = testApi.stepBack({ namespace: "studio", sessionName: "studio-12345" });
  assert.deepEqual(next, { namespace: "studio", sessionName: null });
});

test("back unwinds from studio context to top level", () => {
  const next = testApi.stepBack({ namespace: "studio", sessionName: null });
  assert.deepEqual(next, { namespace: null, sessionName: null });
});

test("prompt renders the bound session path", () => {
  const prompt = testApi.getPrompt({ namespace: "studio", sessionName: "studio-12345" });
  assert.equal(prompt, "robotick:studio:studio-12345> ");
});

test("session helpers understand the provisional studio pid format", () => {
  assert.equal(testApi.parseSessionPid("studio-12345"), 12345);
  assert.equal(testApi.parseSessionPid("barr-e"), null);
});

test("reconcileBoundSession clears stale bound context", () => {
  const workspace = createFakeWorkspace();
  const state = { namespace: "studio", sessionName: "studio-12345" };
  const message = testApi.reconcileBoundSession(workspace, state);
  assert.equal(message, "Studio session studio-12345 closed.");
  assert.deepEqual(state, { namespace: "studio", sessionName: null });
});
