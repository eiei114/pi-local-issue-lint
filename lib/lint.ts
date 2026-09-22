import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

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

function scalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1).split(",").map((item) => scalar(item)).filter((item) => item !== "");
  }
  return trimmed;
}

function parseFrontmatter(text: string): { parsed?: ParsedFrontmatter; error?: { code: string; line: number; message: string; hint: string } } {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.replace(/^\uFEFF/, "") !== "---") {
    return { error: { code: "FRONTMATTER_MISSING", line: 1, message: "YAML frontmatter is missing.", hint: "Start the file with a line containing --- followed by the issue fields." } };
  }
  const values = new Map<string, unknown>();
  const fieldLines = new Map<string, number>();
  let close = -1;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "---") { close = index; break; }
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^(\s*)([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line);
    if (!match) continue;
    const key = match[2];
    if (values.has(key)) {
      return { error: { code: "FRONTMATTER_DUPLICATE_FIELD", line: index + 1, message: `Frontmatter field '${key}' is duplicated.`, hint: "Keep each frontmatter field only once." } };
    }
    let value = match[3] ?? "";
    const list: unknown[] = [];
    let next = index + 1;
    while (next < lines.length && /^\s+-\s+/.test(lines[next] ?? "")) {
      list.push(scalar((lines[next] ?? "").replace(/^\s+-\s+/, "")));
      next += 1;
    }
    if (list.length > 0) { value = ""; index = next - 1; }
    values.set(key, list.length > 0 ? list : scalar(value));
    fieldLines.set(key, index + 1);
  }
  if (close < 0) return { error: { code: "FRONTMATTER_UNTERMINATED", line: lines.length, message: "YAML frontmatter is not terminated.", hint: "Add a closing --- marker after the frontmatter fields." } };
  const after = close + 1;
  const duplicateOffset = lines.slice(after).findIndex((line) => line.trim() === "---");
  if (duplicateOffset >= 0) {
    return { error: { code: "FRONTMATTER_DUPLICATE_MARKER", line: after + duplicateOffset + 1, message: "Duplicate frontmatter marker found.", hint: "Use one frontmatter block at the beginning of the file." } };
  }
  return { parsed: { values, lines: fieldLines, body: lines.slice(after).join("\n"), bodyStart: after + 1 } };
}

function finding(path: string, code: string, message: string, hint: string, location?: LocalIssueFinding["location"]): LocalIssueFinding {
  return { severity: "error", code, path, location, message, hint, docs_ref: DOCS_REF };
}

function isValidRequiredField(field: string, value: unknown): boolean {
  if (field === "ready_for_multica") return typeof value === "boolean";
  return typeof value === "string" && value.trim() !== "";
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
    if (!values.has(field) || !isValidRequiredField(field, values.get(field))) {
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
  return {
    ok: linted.findings.every((item) => item.severity !== "error"),
    summary: summarize(linted.findings, 1, linted.ready ? 1 : 0),
    findings,
  };
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
