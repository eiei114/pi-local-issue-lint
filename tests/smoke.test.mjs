import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const autoReleaseWorkflow = await readFile(new URL("../.github/workflows/auto-release.yml", import.meta.url), "utf8");
const publishWorkflow = await readFile(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");
const registerExtension = (await import("../extensions/index.ts")).default;

test("package declares pi extension", () => {
  assert.deepEqual(packageJson.pi.extensions, ["./extensions"]);
});

test("package is discoverable as a Pi package", () => {
  assert.ok(packageJson.keywords.includes("pi-package"));
  assert.equal(packageJson.name, "pi-local-issue-lint");
});

test("package does not ship template example resources", () => {
  assert.equal(packageJson.pi.skills, undefined);
  assert.equal(packageJson.pi.prompts, undefined);
  assert.equal(packageJson.pi.themes, undefined);
  assert.ok(!packageJson.keywords.includes("agent-skill"));
});

test("extension module registers local_issue_lint tool and check command", () => {
  assert.equal(typeof registerExtension, "function");

  const commands = [];
  const tools = [];

  registerExtension({
    on() {},
    registerCommand(name, spec) {
      commands.push({ name, ...spec });
    },
    registerTool(spec) {
      tools.push(spec);
    },
  });

  assert.equal(commands.length, 1);
  assert.equal(commands[0].name, "local-issue-lint:check");
  assert.match(commands[0].description, /local issue lint/i);

  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "local_issue_lint");
  assert.ok(tools[0].parameters);
  assert.equal(typeof tools[0].execute, "function");
});

test("template includes npm release workflow handoff", () => {
  assert.match(autoReleaseWorkflow, /actions:\s*write/);
  assert.match(autoReleaseWorkflow, /contents:\s*write/);
  assert.match(autoReleaseWorkflow, /gh workflow run publish\.yml/);
  assert.match(publishWorkflow, /id-token:\s*write/);
  assert.match(publishWorkflow, /workflow_dispatch:/);
  assert.match(publishWorkflow, /npm publish --access public/);
});
