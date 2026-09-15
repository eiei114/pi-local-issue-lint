import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { formatLintSummary, localIssueLint } = await import("../lib/lint.ts");

test("localIssueLint accepts a single markdown file and returns stub ok contract", () => {
  const file = path.join(process.cwd(), "README.md");
  const result = localIssueLint({ target: file });

  assert.equal(result.ok, true);
  assert.equal(result.summary.scanned, 1);
  assert.equal(result.summary.ready, 1);
  assert.equal(result.summary.errors, 0);
  assert.deepEqual(result.findings, []);
});

test("localIssueLint returns error when target is missing", () => {
  const result = localIssueLint({ target: "does-not-exist.md" });

  assert.equal(result.ok, false);
  assert.equal(result.summary.errors, 1);
  assert.equal(result.findings[0]?.code, "TARGET_NOT_FOUND");
});

test("localIssueLint warns for directory targets in walking skeleton", () => {
  const result = localIssueLint({ target: "." });

  assert.equal(result.ok, true);
  assert.equal(result.findings[0]?.code, "STUB_DIRECTORY_UNSUPPORTED");
});

test("localIssueLint warns for glob targets in walking skeleton", () => {
  const result = localIssueLint({ target: "Issues/*.md" });

  assert.equal(result.ok, true);
  assert.equal(result.findings[0]?.code, "STUB_GLOB_UNSUPPORTED");
});

test("localIssueLint requires target", () => {
  const result = localIssueLint({ target: "   " });

  assert.equal(result.ok, false);
  assert.equal(result.findings[0]?.code, "TARGET_REQUIRED");
});

test("formatLintSummary renders readable stub output", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-issue-lint-"));
  const issuePath = path.join(tmpDir, "sample-issue.md");
  fs.writeFileSync(issuePath, "# sample\n");

  try {
    const result = localIssueLint({ target: issuePath });
    const summary = formatLintSummary(result, issuePath);

    assert.match(summary, /Local Issue Lint \(walking skeleton\)/);
    assert.match(summary, /Scanned: 1/);
    assert.match(summary, /OK/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
