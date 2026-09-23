import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";

export type LocalIssueSeverity = "error" | "warning" | "info";
export type LocalIssueLintSummary = { scanned: number; ready: number; errors: number; warnings: number; hints: number };
export type LocalIssueFinding = { severity: LocalIssueSeverity; code: string; path: string; location?: { line?: number; field?: string; section?: string }; message: string; hint: string; docs_ref?: string };
export type LocalIssueLintInput = { target: string; projectRoot?: string; policyPreset?: "multica-local-issue-v1"; includeDrafts?: boolean; maxFindings?: number; outputMode?: "compact" | "full" };
export type LocalIssueLintResult = { ok: boolean; summary: LocalIssueLintSummary; findings: LocalIssueFinding[] };

const EMPTY_SUMMARY: LocalIssueLintSummary = { scanned: 0, ready: 0, errors: 0, warnings: 0, hints: 0 };
const DOCS_REF = "local-issue-import-format-v1";
const REQUIRED_FIELDS = ["title", "ready_for_multica", "status", "project_key"];
const REQUIRED_SECTIONS = ["Parent", "What to build", "Acceptance criteria"];
type ParsedFrontmatter = { values: Map<string, unknown>; lines: Map<string, number>; body: string; bodyStart: number };
type IssueRecord = { path: string; aliases: string[]; status: string; blockedBy: string[]; unblocks: string[]; findings: LocalIssueFinding[]; ready: boolean };

function summarize(findings: LocalIssueFinding[], scanned: number, ready: number): LocalIssueLintSummary {
  let errors = 0, warnings = 0, hints = 0;
  for (const item of findings) { if (item.severity === "error") errors += 1; else if (item.severity === "warning") warnings += 1; else hints += 1; }
  return { scanned, ready, errors, warnings, hints };
}
function boundedFindings(findings: LocalIssueFinding[], max: number | undefined): LocalIssueFinding[] { return max === undefined || max < 0 ? findings : findings.slice(0, max); }
function scalar(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  if (trimmed === "true") return true; if (trimmed === "false") return false; if (trimmed === "null") return null;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) return trimmed.slice(1, -1).split(",").map(scalar).filter((item) => item !== "");
  return trimmed;
}
function parseFrontmatter(text: string): { parsed?: ParsedFrontmatter; error?: { code: string; line: number; message: string; hint: string } } {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.replace(/^\uFEFF/, "") !== "---") return { error: { code: "FRONTMATTER_MISSING", line: 1, message: "YAML frontmatter is missing.", hint: "Start the file with a line containing --- followed by the issue fields." } };
  const values = new Map<string, unknown>(), fieldLines = new Map<string, number>(); let close = -1;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ""; if (line.trim() === "---") { close = index; break; } if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^(\s*)([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line); if (!match) continue;
    const key = match[2]; if (values.has(key)) return { error: { code: "FRONTMATTER_DUPLICATE_FIELD", line: index + 1, message: `Frontmatter field '${key}' is duplicated.`, hint: "Keep each frontmatter field only once." } };
    let value = match[3] ?? ""; const list: unknown[] = []; let next = index + 1;
    while (next < lines.length && /^\s+-\s+/.test(lines[next] ?? "")) { list.push(scalar((lines[next] ?? "").replace(/^\s+-\s+/, ""))); next += 1; }
    if (list.length) { value = ""; index = next - 1; } values.set(key, list.length ? list : scalar(value)); fieldLines.set(key, index + 1);
  }
  if (close < 0) return { error: { code: "FRONTMATTER_UNTERMINATED", line: lines.length, message: "YAML frontmatter is not terminated.", hint: "Add a closing --- marker after the frontmatter fields." } };
  const after = close + 1, duplicateOffset = lines.slice(after).findIndex((line) => line.trim() === "---");
  if (duplicateOffset >= 0) return { error: { code: "FRONTMATTER_DUPLICATE_MARKER", line: after + duplicateOffset + 1, message: "Duplicate frontmatter marker found.", hint: "Use one frontmatter block at the beginning of the file." } };
  return { parsed: { values, lines: fieldLines, body: lines.slice(after).join("\n"), bodyStart: after + 1 } };
}
function finding(path: string, code: string, message: string, hint: string, location?: LocalIssueFinding["location"], severity: LocalIssueSeverity = "error"): LocalIssueFinding { return { severity, code, path, location, message, hint, docs_ref: DOCS_REF }; }
function isValidRequiredField(field: string, value: unknown): boolean { return field === "ready_for_multica" ? typeof value === "boolean" : typeof value === "string" && value.trim() !== ""; }
function withoutFencedCodeBlocks(body: string): string { let fence: "`" | "~" | null = null; return body.split(/\r?\n/).map((line) => { const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]; if (marker) { const type = marker[0] as "`" | "~"; if (fence === null) fence = type; else if (fence === type) fence = null; return ""; } return fence === null ? line : ""; }).join("\n"); }
function listValue(value: unknown): string[] { if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim()); return typeof value === "string" && value.trim() ? [value.trim()] : []; }
function aliasesFor(path: string, root: string): string[] { const rel = relative(root, path).split(sep).join("/"); const noExt = rel.replace(/\.md$/i, ""); return [...new Set([noExt, basename(noExt), path.split(sep).join("/")])]; }
function allMarkdownFiles(root: string): string[] { const result: string[] = []; const walk = (dir: string): void => { for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const path = resolve(dir, entry.name); if (entry.isDirectory()) walk(path); else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") result.push(path); } }; walk(root); return result; }
function globRegex(pattern: string): RegExp { let out = "^"; for (let i = 0; i < pattern.length; i += 1) { const c = pattern[i]; if (c === "*") out += pattern[i + 1] === "*" ? (i += 1, ".*") : "[^/]*"; else if (c === "?") out += "[^/]"; else if (c === "[") { const end = pattern.indexOf("]", i + 1); if (end >= 0) { out += pattern.slice(i, end + 1); i = end; } else out += "\\["; } else out += c.replace(/[.+^${}()|\\]/g, "\\$&"); } return new RegExp(`${out}$`, "i"); }
function expandTarget(target: string, root: string): string[] {
  if (/[ *?\[\]{}]/.test(target)) {
    const pattern = target.split(sep).join("/");
    return allMarkdownFiles(root).filter((file) => globRegex(pattern).test(relative(root, file).split(sep).join("/") ) || globRegex(pattern).test(file.split(sep).join("/")));
  }
  const resolved = resolve(root, target); let stats; try { stats = statSync(resolved); } catch { return []; }
  if (stats.isDirectory()) return allMarkdownFiles(resolved);
  return [resolved];
}
function lintFile(path: string, root: string): IssueRecord {
  const aliases = aliasesFor(path, root); let text: string; try { text = readFileSync(path, "utf8"); } catch { return { path, aliases, status: "", blockedBy: [], unblocks: [], ready: false, findings: [finding(path, "TARGET_READ_FAILED", "Target file could not be read.", "Check file permissions and encoding.")] }; }
  const parsed = parseFrontmatter(text); if (!parsed.parsed) { const e = parsed.error!; return { path, aliases, status: "", blockedBy: [], unblocks: [], ready: false, findings: [finding(path, e.code, e.message, e.hint, { line: e.line })] }; }
  const { values, body, bodyStart } = parsed.parsed, findings: LocalIssueFinding[] = [];
  for (const field of REQUIRED_FIELDS) if (!values.has(field) || !isValidRequiredField(field, values.get(field))) findings.push(finding(path, "FRONTMATTER_FIELD_REQUIRED", `Required frontmatter field '${field}' is missing.`, `Add '${field}' to the YAML frontmatter.`, { field }));
  const status = typeof values.get("status") === "string" ? values.get("status") as string : "";
  if (status && status !== "ready" && status !== "blocked") findings.push(finding(path, "STATUS_INVALID", `Status '${status}' is not importable.`, "Use status: ready or status: blocked.", { field: "status" }));
  const importReady = values.get("ready_for_multica") === true && status === "ready";
  if (importReady) { const sectionBody = withoutFencedCodeBlocks(body); for (const section of REQUIRED_SECTIONS) { const pattern = new RegExp(`^##\\s+${section.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*$`, "mi"); if (!pattern.test(sectionBody)) findings.push(finding(path, "BODY_SECTION_REQUIRED", `Required body section '${section}' is missing.`, `Add a '## ${section}' section to the issue body.`, { section, line: bodyStart })); } }
  return { path, aliases, status, blockedBy: listValue(values.get("blocked_by")), unblocks: listValue(values.get("unblocks")), ready: importReady && findings.length === 0, findings };
}
function dependencyFindings(records: IssueRecord[]): void {
  const byAlias = new Map<string, IssueRecord>(); for (const record of records) for (const alias of record.aliases) if (!byAlias.has(alias)) byAlias.set(alias, record);
  const resolveDep = (value: string): IssueRecord | undefined => byAlias.get(value) ?? byAlias.get(value.replace(/\\/g, "/").replace(/\.md$/i, ""));
  for (const record of records) {
    for (const dep of record.blockedBy) if (!resolveDep(dep)) record.findings.push(finding(record.path, record.status === "blocked" ? "DEPENDENCY_MISSING_WARNING" : "DEPENDENCY_MISSING", `Dependency '${dep}' was not found among scanned issues.`, "Use a filename stem or relative issue path that exists locally.", { field: "blocked_by" }, record.status === "blocked" ? "warning" : "error"));
    for (const target of record.unblocks) { const other = resolveDep(target); if (other && !other.blockedBy.some((dep) => resolveDep(dep) === record)) record.findings.push(finding(record.path, "DEPENDENCY_NON_RECIPROCAL", `unblocks '${target}' is not mirrored by blocked_by on that issue.`, "Add this issue to the target's blocked_by list.", { field: "unblocks" }, "warning")); }
    for (const dep of record.blockedBy) { const other = resolveDep(dep); if (other && !other.unblocks.some((target) => resolveDep(target) === record)) record.findings.push(finding(record.path, "DEPENDENCY_NON_RECIPROCAL", `blocked_by '${dep}' is not mirrored by unblocks on that issue.`, "Add the dependent issue to the dependency's unblocks list.", { field: "blocked_by" }, "warning")); }
  }
  const state = new Map<IssueRecord, number>(), stack: IssueRecord[] = []; const visit = (record: IssueRecord): void => { if (state.get(record) === 1) { const start = stack.indexOf(record); const cycle = [...stack.slice(start), record].map((item) => basename(item.path, extname(item.path))).join(" -> "); record.findings.push(finding(record.path, "DEPENDENCY_CYCLE", `Dependency cycle detected: ${cycle}.`, "Remove one dependency edge so the local issue graph is acyclic.", { field: "blocked_by" })); return; } if (state.get(record) === 2) return; state.set(record, 1); stack.push(record); for (const dep of record.blockedBy) { const next = resolveDep(dep); if (next) visit(next); } stack.pop(); state.set(record, 2); }; for (const record of records) visit(record);
}
export function localIssueLint(input: LocalIssueLintInput): LocalIssueLintResult {
  const target = input.target.trim(), root = input.projectRoot ? resolve(input.projectRoot) : process.cwd();
  if (!target) { const findings = boundedFindings([finding(target, "TARGET_REQUIRED", "target is required", "Pass a local issue markdown file path.")], input.maxFindings); return { ok: false, summary: summarize(findings, 0, 0), findings }; }
  const paths = expandTarget(target, root); if (!paths.length) { const path = resolve(root, target); const findings = boundedFindings([finding(path, "TARGET_NOT_FOUND", "Target path does not exist.", "Check the file path and try again.")], input.maxFindings); return { ok: false, summary: summarize(findings, 0, 0), findings }; }
  const records = paths.sort((a, b) => a.localeCompare(b)).map((path) => lintFile(path, root)); dependencyFindings(records);
  const allFindings = records.flatMap((record) => record.findings), findings = boundedFindings(allFindings, input.maxFindings), ready = records.filter((record) => record.ready).length;
  return { ok: allFindings.every((item) => item.severity !== "error"), summary: summarize(allFindings, records.length, ready), findings };
}
export function formatLintSummary(result: LocalIssueLintResult, targetLabel?: string): string { const lines = ["Local Issue Lint (walking skeleton)", targetLabel ? `Target: ${targetLabel}` : undefined, `Scanned: ${result.summary.scanned} | Ready: ${result.summary.ready} | Errors: ${result.summary.errors} | Warnings: ${result.summary.warnings} | Hints: ${result.summary.hints}`, result.ok ? "OK" : "FAILED"].filter((line): line is string => line !== undefined); if (result.findings.length) { lines.push("", "Findings:"); for (const item of result.findings) { lines.push(`- [${item.severity}] ${item.code}: ${item.message}`); lines.push(`  hint: ${item.hint}`); } } return lines.join("\n"); }
export function emptyLintResult(): LocalIssueLintResult { return { ok: true, summary: { ...EMPTY_SUMMARY }, findings: [] }; }
