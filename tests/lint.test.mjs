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

test("localIssueLint rejects null and wrong-shaped required fields", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-issue-lint-"));
  const file = path.join(tmpDir, "invalid-fields.md");
  fs.writeFileSync(file, "---\ntitle: null\nready_for_multica: \"true\"\nstatus: []\nproject_key: 42\n---\n");
  try {
    const result = localIssueLint({ target: file });
    const fields = result.findings.filter((item) => item.code === "FRONTMATTER_FIELD_REQUIRED").map((item) => item.location.field);
    assert.deepEqual(fields, ["title", "ready_for_multica", "status", "project_key"]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("localIssueLint reports a duplicate marker on the first body line", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-issue-lint-"));
  const file = path.join(tmpDir, "duplicate-marker.md");
  fs.writeFileSync(file, "---\ntitle: Example\nready_for_multica: true\nstatus: ready\nproject_key: demo\n---\n---\n");
  try {
    const result = localIssueLint({ target: file });
    assert.equal(result.findings[0].code, "FRONTMATTER_DUPLICATE_MARKER");
    assert.equal(result.findings[0].location.line, 7);
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

test("localIssueLint ignores headings inside fenced code blocks", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-issue-lint-"));
  const file = path.join(tmpDir, "fenced-sections.md");
  fs.writeFileSync(file, "---\ntitle: Example\nready_for_multica: true\nstatus: ready\nproject_key: demo\n---\n```md\n## Parent\n## What to build\n## Acceptance criteria\n```\n");
  try {
    const result = localIssueLint({ target: file });
    assert.equal(result.ok, false);
    assert.equal(result.findings.filter((item) => item.code === "BODY_SECTION_REQUIRED").length, 3);
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

test("localIssueLint scans directory targets", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-issue-lint-"));
  fs.writeFileSync(path.join(tmpDir, "a.md"), "---\ntitle: A\nready_for_multica: true\nstatus: ready\nproject_key: demo\n---\n## Parent\n## What to build\n## Acceptance criteria\n");
  fs.writeFileSync(path.join(tmpDir, "b.md"), "---\ntitle: B\nready_for_multica: true\nstatus: ready\nproject_key: demo\n---\n## Parent\n## What to build\n## Acceptance criteria\n");
  try {
    const result = localIssueLint({ target: tmpDir });
    assert.equal(result.ok, true);
    assert.equal(result.summary.scanned, 2);
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

test("localIssueLint scans glob targets", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-issue-lint-"));
  fs.writeFileSync(path.join(tmpDir, "a.md"), "---\ntitle: A\nready_for_multica: true\nstatus: ready\nproject_key: demo\n---\n## Parent\n## What to build\n## Acceptance criteria\n");
  try {
    const result = localIssueLint({ target: "*.md", projectRoot: tmpDir });
    assert.equal(result.ok, true);
    assert.equal(result.summary.scanned, 1);
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
});

test("localIssueLint reports invalid glob syntax instead of throwing", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-issue-lint-"));
  fs.writeFileSync(path.join(tmpDir, "issue.md"), "# issue\n");
  try {
    const result = localIssueLint({ target: "[z-a].md", projectRoot: tmpDir });
    assert.equal(result.ok, false);
    assert.equal(result.summary.errors, 1);
    assert.equal(result.findings[0]?.code, "TARGET_GLOB_INVALID");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("localIssueLint matches **/*.md at the root and nested levels", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-issue-lint-"));
  const nestedDir = path.join(tmpDir, "nested");
  fs.mkdirSync(nestedDir);
  const issue = (title) => `---\ntitle: ${title}\nready_for_multica: true\nstatus: ready\nproject_key: demo\n---\n## Parent\n## What to build\n## Acceptance criteria\n`;
  fs.writeFileSync(path.join(tmpDir, "root.md"), issue("Root"));
  fs.writeFileSync(path.join(nestedDir, "nested.md"), issue("Nested"));

  try {
    const result = localIssueLint({ target: "**/*.md", projectRoot: tmpDir });
    assert.equal(result.ok, true);
    assert.equal(result.summary.scanned, 2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("localIssueLint treats spaces and braces as literal path characters", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-issue-lint-"));
  const literalDir = path.join(tmpDir, "folder with {braces}");
  fs.mkdirSync(literalDir);
  fs.writeFileSync(path.join(literalDir, "issue.md"), "---\ntitle: Literal path\nready_for_multica: true\nstatus: ready\nproject_key: demo\n---\n## Parent\n## What to build\n## Acceptance criteria\n");

  try {
    const result = localIssueLint({ target: literalDir, projectRoot: tmpDir });
    assert.equal(result.ok, true);
    assert.equal(result.summary.scanned, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("localIssueLint reports ambiguous aliases and excludes dependency errors from ready count", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-issue-lint-"));
  const issue = (title, dependencies = "") => `---\ntitle: ${title}\nready_for_multica: true\nstatus: ready\nproject_key: demo\n${dependencies}---\n## Parent\n## What to build\n## Acceptance criteria\n`;
  fs.mkdirSync(path.join(tmpDir, "a"));
  fs.mkdirSync(path.join(tmpDir, "b"));
  fs.writeFileSync(path.join(tmpDir, "a", "setup.md"), issue("Setup A"));
  fs.writeFileSync(path.join(tmpDir, "b", "setup.md"), issue("Setup B"));
  fs.writeFileSync(path.join(tmpDir, "dependent.md"), issue("Dependent", "blocked_by:\n  - setup\n"));

  try {
    const result = localIssueLint({ target: tmpDir });
    assert.equal(result.ok, false);
    assert.equal(result.summary.ready, 2);
    assert.ok(result.findings.some((item) => item.code === "DEPENDENCY_AMBIGUOUS"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("localIssueLint reports missing unblocks targets and excludes them from ready count", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-issue-lint-"));
  const issue = "---\ntitle: Dependent\nready_for_multica: true\nstatus: ready\nproject_key: demo\nunblocks: missing\n---\n## Parent\n## What to build\n## Acceptance criteria\n";
  fs.writeFileSync(path.join(tmpDir, "dependent.md"), issue);

  try {
    const result = localIssueLint({ target: tmpDir });
    assert.equal(result.ok, false);
    assert.equal(result.summary.ready, 0);
    assert.ok(result.findings.some((item) => item.code === "DEPENDENCY_MISSING" && item.location.field === "unblocks"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("localIssueLint requires target", () => {
  const result = localIssueLint({ target: "   " });

  assert.equal(result.ok, false);
  assert.equal(result.findings[0]?.code, "TARGET_REQUIRED");
});

test("localIssueLint keeps invalid status when findings are bounded to zero", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-issue-lint-"));
  const file = path.join(tmpDir, "invalid.md");
  fs.writeFileSync(file, "---\ntitle: Example\nready_for_multica: true\nstatus: ready\n---\n## Parent\n## What to build\n## Acceptance criteria\n");
  try {
    const result = localIssueLint({ target: file, maxFindings: 0 });
    assert.equal(result.ok, false);
    assert.equal(result.findings.length, 0);
    assert.equal(result.summary.errors, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
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
