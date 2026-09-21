import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { formatLintSummary, localIssueLint } = await import("../lib/lint.ts");

test("localIssueLint accepts a valid ready issue", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-issue-lint-"));
  const file = path.join(tmpDir, "valid.md");
  fs.writeFileSync(file, `---\ntitle: Example\nready_for_multica: true\nstatus: ready\nproject_key: demo\n---\n## Parent\n- PRD: docs\n## What to build\nImplement it.\n## Acceptance criteria\n- [ ] It works.\n`);

  try {
    const result = localIssueLint({ target: file });
    assert.equal(result.ok, true);
    assert.equal(result.summary.ready, 1);
    assert.deepEqual(result.findings, []);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("localIssueLint reports missing frontmatter and required fields", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-issue-lint-"));
  const missing = path.join(tmpDir, "missing.md");
  const fields = path.join(tmpDir, "fields.md");
  fs.writeFileSync(missing, "# no frontmatter\n");
  fs.writeFileSync(fields, "---\ntitle: Example\nready_for_multica: true\nstatus: ready\n---\n");
  try {
    assert.equal(localIssueLint({ target: missing }).findings[0].code, "FRONTMATTER_MISSING");
    const result = localIssueLint({ target: fields });
    assert.ok(result.findings.some((item) => item.code === "FRONTMATTER_FIELD_REQUIRED" && item.location.field === "project_key"));
    assert.ok(result.findings.every((item) => item.docs_ref));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("localIssueLint reports missing required body sections", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-issue-lint-"));
  const file = path.join(tmpDir, "sections.md");
  fs.writeFileSync(file, "---\ntitle: Example\nready_for_multica: true\nstatus: ready\nproject_key: demo\n---\n## Parent\n");
  try {
    const result = localIssueLint({ target: file });
    assert.equal(result.ok, false);
    assert.equal(result.findings.filter((item) => item.code === "BODY_SECTION_REQUIRED").length, 2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
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
  fs.writeFileSync(issuePath, "---\ntitle: Example\nready_for_multica: true\nstatus: ready\nproject_key: demo\n---\n## Parent\n## What to build\n## Acceptance criteria\n");

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
