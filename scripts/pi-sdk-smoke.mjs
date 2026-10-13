import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  behaviorAssertions,
  EXTENSION_LOAD_ERROR_PATTERN,
  parseJsonLines,
  SDK_NAMES,
  UNHANDLED_ERROR_PATTERN,
  VERIFICATION_CONTRACT,
} from "./pi-sdk-smoke-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const reportPath = resolve(root, "docs/verification/pi-sdk-smoke.json");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const manifest = readJson(resolve(root, "package.json"));
const sdkVersions = Object.fromEntries(SDK_NAMES.map((name) => [
  name,
  readJson(resolve(root, "node_modules", name, "package.json")).version,
]));

for (const name of SDK_NAMES) {
  if (manifest.devDependencies?.[name] !== sdkVersions[name]) {
    throw new Error(`Smoke requires exact SDK pin ${name}: installed ${sdkVersions[name]}`);
  }
}

const piManifest = readJson(resolve(root, "node_modules/@earendil-works/pi-coding-agent/package.json"));
const piCli = resolve(root, "node_modules/@earendil-works/pi-coding-agent", piManifest.bin.pi);
const isolatedAgentDir = mkdtempSync(resolve(tmpdir(), "pi-local-issue-lint-smoke-"));
const env = {
  ...process.env,
  PI_CODING_AGENT_DIR: isolatedAgentDir,
  PI_CODING_AGENT_SESSION_DIR: resolve(isolatedAgentDir, "sessions"),
  PI_OFFLINE: "1",
  PI_TELEMETRY: "0",
};
const providerExtension = resolve(root, "scripts/pi-sdk-smoke-provider.mjs");
const packageExtension = resolve(root, "extensions/index.ts");
const rpcArgs = [piCli, "--offline", "--approve", "--no-session", "--no-builtin-tools", "--no-extensions",
  "--no-skills", "--no-context-files", "--no-prompt-templates", "--no-mcp", "--mode", "rpc",
  "--extension", packageExtension, "--extension", providerExtension,
  "--provider", "pi-local-issue-lint-smoke", "--model", "deterministic", "--tools", "local_issue_lint"];

function runProcess(name, executable, args, input, extraEnv = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    env: { ...env, ...extraEnv },
    input,
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 5 * 1024 * 1024,
    windowsHide: true,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? `\n${result.error.message}` : ""}`;
  const responses = [...parseJsonLines(result.stdout ?? ""), ...parseJsonLines(result.stderr ?? "")];
  const processExited = result.status !== null && result.signal === null && result.error === undefined;
  const exitCode = processExited ? result.status : 1;
  return { name, output, responses, exitCode, processExited, spawnError: result.error?.message };
}

function fixturePath(name) {
  const directory = resolve(isolatedAgentDir, name);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function capturedEvidence(responses, processResults, name) {
  const events = responses.flatMap((row) => {
    if (row.type === "response" && row.command === "get_commands") {
      return [{ type: row.type, command: row.command, success: row.success,
        commands: row.data?.commands?.map(({ name: commandName, source }) => ({ name: commandName, source })) ?? [] }];
    }
    if (row.type === "response" && row.command === "prompt") {
      return [{ type: row.type, command: row.command, success: row.success, disposition: row.data?.disposition }];
    }
    if (row.type === "tool_execution_end" && row.toolName === "local_issue_lint") {
      const details = row.result?.details;
      return [{ type: row.type, toolName: row.toolName, isError: row.isError,
        details: details ? {
          ok: details.ok,
          summary: details.summary,
          findings: details.findings?.map(({ code, severity, message }) => ({ code, severity, message })) ?? [],
        } : null }];
    }
    if (row.type === "message_end" && row.message?.role === "assistant") {
      return [{ type: row.type, role: "assistant",
        text: row.message.content?.filter((part) => part.type === "text").map((part) => part.text).join("") ?? "" }];
    }
    if (row.type === "agent_end") {
      const tools = row.messages?.filter((message) => message.role === "system")
        .flatMap((message) => message.toolsAdded ?? []).map((tool) => tool.name) ?? [];
      return [{ type: row.type, registered_tools: tools }];
    }
    if (row.type === "extension_error") {
      return [{ type: row.type, event: row.event, error: row.error }];
    }
    return [];
  });
  const result = {
    processes: processResults.map(({ name: processName, exitCode, processExited }) => ({
      name: processName,
      exit_code: exitCode,
      exited: processExited,
    })),
    events,
  };
  if (name === "host_shell") {
    result.shell_output = processResults.map((item) => item.output).join("").trim();
  }
  return JSON.stringify(result);
}

function rpcPrompt() {
  return `${JSON.stringify({ id: "smoke-prompt", type: "prompt", message: "Run the local issue lint tool." })}\n`;
}

function runRpcCase(name, target, { commandsOnly = false } = {}) {
  const localEnv = commandsOnly ? {} : { PI_LOCAL_ISSUE_LINT_SMOKE_TARGET: target };
  const commands = `${JSON.stringify({ id: "smoke-commands", type: "get_commands" })}\n`;
  const processResult = runProcess(name, process.execPath, rpcArgs,
    commandsOnly ? commands : `${commands}${rpcPrompt()}`, localEnv);
  return processResult;
}

function collectCase(name, processResults, expectedVersion) {
  const responsesByProcess = processResults.map((result) => result.responses);
  const responses = responsesByProcess.flat();
  const fullOutput = processResults.map((result) => result.output).join("\n");
  const exitCode = processResults.every((result) => result.exitCode === 0) ? 0 : 1;
  const processExited = processResults.every((result) => result.processExited);
  const assertions = behaviorAssertions(name, {
    responses,
    responsesByProcess,
    fullOutput,
    exit_code: exitCode,
    process_exited: processExited,
    expectedVersion,
  });
  const hasUnhandledError = UNHANDLED_ERROR_PATTERN.test(fullOutput)
    || responses.some((row) => row.type === "extension_error");
  const hasLoadError = EXTENSION_LOAD_ERROR_PATTERN.test(fullOutput)
    || responses.some((row) => row.type === "extension_error");
  const passed = exitCode === 0 && processExited && !hasUnhandledError && !hasLoadError
    && assertions.every((item) => item.passed);
  const evidence = capturedEvidence(responses, processResults, name);
  return {
    name,
    command: "npm run smoke:pi",
    exit_code: exitCode,
    passed,
    evidence: evidence || processResults.map((result) => result.spawnError).filter(Boolean).join("; ") || "No output captured",
    assertions,
    hasUnhandledError,
    hasLoadError,
  };
}

function quotePowerShell(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

try {
  const sdkVersion = sdkVersions["@earendil-works/pi-coding-agent"];
  const cases = [];
  const loadDir = fixturePath("extension-load");
  const loadTarget = resolve(loadDir, "valid-issue.md");
  writeFileSync(loadTarget, "---\ntitle: Extension Load Smoke\nready_for_multica: true\nstatus: ready\nproject_key: smoke\n---\n## Parent\n## What to build\nSmoke test.\n## Acceptance criteria\nThe lint succeeds.\n", "utf8");
  cases.push(collectCase("extension_load", [runRpcCase("extension_load", loadTarget)], sdkVersion));

  const validDir = fixturePath("happy-path");
  const validTarget = resolve(validDir, "valid-issue.md");
  writeFileSync(validTarget, "---\ntitle: Smoke Issue\nready_for_multica: true\nstatus: ready\nproject_key: smoke\n---\n## Parent\n## What to build\nSmoke test.\n## Acceptance criteria\nThe lint succeeds.\n", "utf8");
  cases.push(collectCase("happy_path", [runRpcCase("happy_path", validTarget)], sdkVersion));

  const missingTarget = resolve(fixturePath("error-path"), "missing-issue.md");
  cases.push(collectCase("error_path", [runRpcCase("error_path", missingTarget)], sdkVersion));

  const reloadTarget = resolve(fixturePath("reload-cleanup"), "valid-issue.md");
  writeFileSync(reloadTarget, "---\ntitle: Reload Smoke Issue\nready_for_multica: true\nstatus: ready\nproject_key: smoke\n---\n## Parent\n## What to build\nSmoke test.\n## Acceptance criteria\nThe lint succeeds.\n", "utf8");
  const firstHost = runRpcCase("reload_cleanup_first", reloadTarget, { commandsOnly: true });
  const secondHost = runRpcCase("reload_cleanup_second", reloadTarget);
  cases.push(collectCase("reload_cleanup", [firstHost, secondHost], sdkVersion));

  if (process.platform === "win32") {
    const powershell = resolve(process.env.SystemRoot ?? "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
    const command = `& ${quotePowerShell(process.execPath)} ${quotePowerShell(piCli)} --no-extensions --version; exit $LASTEXITCODE`;
    cases.push(collectCase("host_shell", [runProcess("host_shell", powershell,
      ["-NoProfile", "-NonInteractive", "-Command", command], "")], sdkVersion));
  } else {
    const hostShell = runProcess("host_shell", "/bin/sh", ["-c", '"$1" "$2" --no-extensions --version',
      "pi-host-shell", process.execPath, piCli], "");
    cases.push(collectCase("host_shell", [hostShell], sdkVersion));
  }

  const report = {
    schema_version: 1,
    verification_contract: VERIFICATION_CONTRACT,
    sdk_versions: sdkVersions,
    platform: process.platform,
    model_inference: "none; deterministic offline provider drives the real Pi agent loop and actual local_issue_lint tool",
    unhandled_errors: cases.filter((item) => item.hasUnhandledError).length,
    extension_load_errors: cases.filter((item) => item.hasLoadError || (item.name === "extension_load" && !item.passed)).length,
    cases: cases.map(({ hasUnhandledError, hasLoadError, ...item }) => item),
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    verification_contract: VERIFICATION_CONTRACT,
    platform: process.platform,
    cases: cases.map((item) => ({ name: item.name, passed: item.passed, exit_code: item.exit_code })),
  }));
  if (cases.some((item) => !item.passed)) process.exitCode = 1;
} finally {
  rmSync(isolatedAgentDir, { recursive: true, force: true });
}
