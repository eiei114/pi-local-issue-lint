import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parseDocument } from "yaml";

export type LocalIssueSeverity = "error" | "warning" | "info";

export type LocalIssueLintSummary = {
  scanned: number;
  ready: number;
  errors: number;
  warnings: number;
  hints: number;
};

export type LocalIssueFinding = {
  severity: LocalIssueSeverity;
  code: string;
  path: string;
  location?: { line?: number; field?: string; section?: string };
  message: string;
  hint: string;
  docs_ref?: string;
};

export type LocalIssueLintInput = {
  target: string;
  projectRoot?: string;
  policyPreset?: "multica-local-issue-v1";
  includeDrafts?: boolean;
  maxFindings?: number;
  outputMode?: "compact" | "full";
};

export type LocalIssueLintResult = {
  ok: boolean;
  summary: LocalIssueLintSummary;
  findings: LocalIssueFinding[];
};

const EMPTY_SUMMARY: LocalIssueLintSummary = {
  scanned: 0,
  ready: 0,
  errors: 0,
  warnings: 0,
  hints: 0,
};
const DOCS_REF = "local-issue-import-format-v1";
const REQUIRED_FIELDS = ["title", "ready_for_multica", "status", "project_key"];
const REQUIRED_SECTIONS = ["Parent", "What to build", "Acceptance criteria"];

type ParsedFrontmatter = { values: Map<string, unknown>; lines: Map<string, number>; body: string; bodyStart: number };

function looksLikeGlob(target: string): boolean {
  return /[*?[\]{}]/.test(target);
}

function summarize(findings: LocalIssueFinding[], scanned: number, ready: number): LocalIssueLintSummary {
  let errors = 0;
  let warnings = 0;
  let hints = 0;
  for (const finding of findings) {
    if (finding.severity === "error") errors += 1;
    else if (finding.severity === "warning") warnings += 1;
    else hints += 1;
  }
  return { scanned, ready, errors, warnings, hints };
}

function boundedFindings(findings: LocalIssueFinding[], maxFindings: number | undefined): LocalIssueFinding[] {
  return maxFindings === undefined || maxFindings < 0 ? findings : findings.slice(0, maxFindings);
}

function parseFrontmatter(text: string): { parsed?: ParsedFrontmatter; error?: { code: string; line: number; message: string; hint: string } } {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.replace(/^\uFEFF/, "") !== "---") {
    return { error: { code: "FRONTMATTER_MISSING", line: 1, message: "YAML frontmatter is missing.", hint: "Start the file with a line containing --- followed by the issue fields." } };
  }
  let close = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if ((lines[index] ?? "").trim() === "---") { close = index; break; }
  }
  if (close < 0) return { error: { code: "FRONTMATTER_UNTERMINATED", line: lines.length, message: "YAML frontmatter is not terminated.", hint: "Add a closing --- marker after the frontmatter fields." } };
  // Include the first body line when looking for a stray marker.
  for (let index = close + 1; index < lines.length; index += 1) {
    if ((lines[index] ?? "").trim() === "---") {
      return { error: { code: "FRONTMATTER_DUPLICATE_MARKER", line: index + 1, message: "Duplicate frontmatter marker found.", hint: "Use one frontmatter block at the beginning of the file." } };
    }
  }
  const document = parseDocument(lines.slice(1, close).join("\n"), { prettyErrors: false });
  if (document.errors.length > 0) {
    const error = document.errors[0];
    const duplicate = /unique|duplicat/i.test(error.message);
    return { error: { code: duplicate ? "FRONTMATTER_DUPLICATE_FIELD" : "FRONTMATTER_INVALID", line: (error.linePos?.[0]?.line ?? 1) + 1, message: `Invalid YAML frontmatter: ${error.message}`, hint: "Fix the YAML syntax and keep each frontmatter field only once." } };
  }
  const source = document.toJS();
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    return { error: { code: "FRONTMATTER_INVALID", line: 2, message: "YAML frontmatter must be a mapping of fields.", hint: "Use key-value fields inside the frontmatter block." } };
  }
  const values = new Map<string, unknown>(Object.entries(source));
  const fieldLines = new Map<string, number>();
  for (let index = 1; index < close; index += 1) {
    const match = /^\s*([A-Za-z0-9_-]+):/.exec(lines[index] ?? "");
    if (match && !fieldLines.has(match[1])) fieldLines.set(match[1], index + 1);
  }
  const after = close + 1;
  return { parsed: { values, lines: fieldLines, body: lines.slice(after).join("\n"), bodyStart: after + 1 } };
}

function withoutFencedCodeBlocks(body: string): string {
  let fence: "`" | "~" | null = null;
  return body.split(/\r?\n/).map((line) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      const markerType = marker[0] as "`" | "~";
      if (fence === null) fence = markerType;
      else if (fence === markerType) fence = null;
      return "";
    }
    return fence === null ? line : "";
  }).join("\n");
}

function finding(path: string, code: string, message: string, hint: string, location?: LocalIssueFinding["location"]): LocalIssueFinding {
  return { severity: "error", code, path, location, message, hint, docs_ref: DOCS_REF };
}

function lintFile(path: string): { findings: LocalIssueFinding[]; ready: boolean } {
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch {
    return { ready: false, findings: [finding(path, "TARGET_READ_FAILED", "Target file could not be read.", "Check file permissions and encoding.")] };
  }
  const frontmatter = parseFrontmatter(text);
  if (!frontmatter.parsed) {
    const error = frontmatter.error!;
    return { ready: false, findings: [finding(path, error.code, error.message, error.hint, { line: error.line })] };
  }
  const { values, lines, body, bodyStart } = frontmatter.parsed;
  const findings: LocalIssueFinding[] = [];
  for (const field of REQUIRED_FIELDS) {
    const value = values.get(field);
    if (!values.has(field) || (field === "ready_for_multica" ? typeof value !== "boolean" : typeof value !== "string" || value.trim() === "")) {
      findings.push(finding(path, "FRONTMATTER_FIELD_REQUIRED", `Required frontmatter field '${field}' is missing.`, `Add '${field}' to the YAML frontmatter.`, { field }));
    }
  }
  const ready = values.get("ready_for_multica") === true && values.get("status") === "ready";
  if (!ready) return { ready: false, findings };
  const sectionBody = withoutFencedCodeBlocks(body);
  for (const section of REQUIRED_SECTIONS) {
    const sectionPattern = new RegExp(`^##\\s+${section.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*$`, "mi");
    if (!sectionPattern.test(sectionBody)) {
      findings.push(finding(path, "BODY_SECTION_REQUIRED", `Required body section '${section}' is missing.`, `Add a '## ${section}' section to the issue body.`, { section, line: bodyStart }));
    }
  }
  return { ready: findings.length === 0, findings };
}

export function localIssueLint(input: LocalIssueLintInput): LocalIssueLintResult {
  const target = input.target.trim();
  const baseDir = input.projectRoot ? resolve(input.projectRoot) : process.cwd();
  if (!target) {
    const findings = boundedFindings([finding(target, "TARGET_REQUIRED", "target is required", "Pass a local issue markdown file path.")], input.maxFindings);
    return { ok: false, summary: summarize(findings, 0, 0), findings };
  }
  if (looksLikeGlob(target)) {
    const item = finding(target, "STUB_GLOB_UNSUPPORTED", "Glob targets are accepted but not implemented.", "Pass a single issue markdown file path.");
    item.severity = "warning";
    const findings = boundedFindings([item], input.maxFindings);
    return { ok: true, summary: summarize(findings, 0, 0), findings };
  }
  const resolved = resolve(baseDir, target);
  let stats;
  try { stats = statSync(resolved); } catch {
    const findings = boundedFindings([finding(resolved, "TARGET_NOT_FOUND", "Target path does not exist.", "Check the file path and try again.")], input.maxFindings);
    return { ok: false, summary: summarize(findings, 0, 0), findings };
  }
  if (stats.isDirectory()) {
    const item = finding(resolved, "STUB_DIRECTORY_UNSUPPORTED", "Directory targets are accepted but not implemented.", "Pass a single issue markdown file path.");
    item.severity = "warning";
    const findings = boundedFindings([item], input.maxFindings);
    return { ok: true, summary: summarize(findings, 0, 0), findings };
  }
  const linted = lintFile(resolved);
  const findings = boundedFindings(linted.findings, input.maxFindings);
  return { ok: linted.findings.every((item) => item.severity !== "error"), summary: summarize(linted.findings, 1, linted.ready ? 1 : 0), findings };
}

export function formatLintSummary(result: LocalIssueLintResult, targetLabel?: string): string {
  const lines = ["Local Issue Lint (walking skeleton)", targetLabel ? `Target: ${targetLabel}` : undefined, `Scanned: ${result.summary.scanned} | Ready: ${result.summary.ready} | Errors: ${result.summary.errors} | Warnings: ${result.summary.warnings} | Hints: ${result.summary.hints}`, result.ok ? "OK" : "FAILED"].filter((line): line is string => line !== undefined);
  if (result.findings.length > 0) {
    lines.push("", "Findings:");
    for (const item of result.findings) { lines.push(`- [${item.severity}] ${item.code}: ${item.message}`); lines.push(`  hint: ${item.hint}`); }
  }
  return lines.join("\n");
}

export function emptyLintResult(): LocalIssueLintResult {
  return { ok: true, summary: { ...EMPTY_SUMMARY }, findings: [] };
}
