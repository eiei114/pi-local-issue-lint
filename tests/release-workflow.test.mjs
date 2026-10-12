import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const workflow = parseDocument(readFileSync(new URL("../.github/workflows/auto-release.yml", import.meta.url), "utf8")).toJS();
const releaseCheckScript = fileURLToPath(new URL("../.github/scripts/check-release-version.mjs", import.meta.url));

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function createReleaseFixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "release-version-check-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet", "-b", "main"], { cwd });
  git(cwd, "config", "user.name", "Release workflow test");
  git(cwd, "config", "user.email", "release-test@example.invalid");

  const commitVersion = (version) => {
    writeFileSync(join(cwd, "package.json"), `${JSON.stringify({ version }, null, 2)}\n`);
    git(cwd, "add", "package.json");
    git(cwd, "commit", "--quiet", "-m", `version ${version}`);
    return git(cwd, "rev-parse", "HEAD");
  };

  const baselineCommit = commitVersion("0.0.1");
  git(cwd, "tag", "v0.0.1", baselineCommit);
  commitVersion("0.1.0");
  return { cwd, baselineCommit };
}

function runReleaseCheck(cwd, eventName, before = "") {
  const outputPath = join(cwd, `github-output-${Date.now()}-${Math.random()}`);
  const stdout = execFileSync(process.execPath, [releaseCheckScript], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: eventName,
      RELEASE_EVENT_BEFORE: before,
      GITHUB_OUTPUT: outputPath,
    },
  });
  const outputs = Object.fromEntries(readFileSync(outputPath, "utf8").trim().split(/\r?\n/).map((line) => line.split("=")));
  rmSync(outputPath);
  return { stdout, outputs };
}

test("release workflow is manually dispatched with explicit confirmation", () => {
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.equal(workflow.on.workflow_dispatch.inputs.confirm_release.required, true);
  assert.equal(workflow.on.workflow_dispatch.inputs.confirm_release.default, false);
  assert.equal(workflow.jobs.release.if, "inputs.confirm_release == true");

  const checkStep = workflow.jobs.release.steps.find((step) => step.name === "Check for version bump");
  assert.equal(checkStep.env.RELEASE_EVENT_BEFORE, "${{ github.event.before }}");
  assert.equal(checkStep.run, "node .github/scripts/check-release-version.mjs");
});

test("manual release compares the package version with the latest release tag", (t) => {
  const { cwd } = createReleaseFixture(t);

  const result = runReleaseCheck(cwd, "workflow_dispatch");
  assert.match(result.stdout, /Version bump detected: 0\.0\.1 -> 0\.1\.0/);
  assert.deepEqual(result.outputs, { released: "true", tag: "v0.1.0" });

  git(cwd, "tag", "v0.1.0");
  const alreadyReleased = runReleaseCheck(cwd, "workflow_dispatch");
  assert.match(alreadyReleased.stdout, /package\.json version did not change/);
  assert.deepEqual(alreadyReleased.outputs, { released: "false" });
});

test("push release comparison still uses the event before commit", (t) => {
  const { cwd, baselineCommit } = createReleaseFixture(t);

  const result = runReleaseCheck(cwd, "push", baselineCommit);
  assert.match(result.stdout, /Version bump detected: 0\.0\.1 -> 0\.1\.0/);
  assert.deepEqual(result.outputs, { released: "true", tag: "v0.1.0" });
});

test("manual release safely skips when no release tag exists", (t) => {
  const { cwd } = createReleaseFixture(t);
  git(cwd, "tag", "--delete", "v0.0.1");

  const result = runReleaseCheck(cwd, "workflow_dispatch");
  assert.match(result.stdout, /No release tag is available/);
  assert.deepEqual(result.outputs, { released: "false" });
});
