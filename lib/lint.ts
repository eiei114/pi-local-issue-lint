import { statSync } from "node:fs";
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

function looksLikeGlob(target: string): boolean {
  return /[*?[\]{}]/.test(target);
}

function summarize(findings: LocalIssueFinding[], scanned: number, ready: number): LocalIssueLintSummary {
  let errors = 0;
  let warnings = 0;
  let hints = 0;

  for (const finding of findings) {
    if (finding.severity === "error") {
      errors += 1;
    } else if (finding.severity === "warning") {
      warnings += 1;
    } else {
      hints += 1;
    }
  }

  return { scanned, ready, errors, warnings, hints };
}

function boundedFindings(
  findings: LocalIssueFinding[],
  maxFindings: number | undefined,
): LocalIssueFinding[] {
  if (maxFindings === undefined || maxFindings < 0) {
    return findings;
  }
  return findings.slice(0, maxFindings);
}

/**
 * Walking-skeleton lint core. Accepts file, directory, or glob targets in the
 * schema, but only single-file paths are implemented in slice 01.
 */
export function localIssueLint(input: LocalIssueLintInput): LocalIssueLintResult {
  const target = input.target.trim();
  const baseDir = input.projectRoot ? resolve(input.projectRoot) : process.cwd();

  if (!target) {
    const finding: LocalIssueFinding = {
      severity: "error",
      code: "TARGET_REQUIRED",
      path: target,
      message: "target is required",
      hint: "Pass a local issue markdown file path.",
    };
    const findings = boundedFindings([finding], input.maxFindings);
    return {
      ok: false,
      summary: summarize(findings, 0, 0),
      findings,
    };
  }

  if (looksLikeGlob(target)) {
    const finding: LocalIssueFinding = {
      severity: "warning",
      code: "STUB_GLOB_UNSUPPORTED",
      path: target,
      message: "Glob targets are accepted but not implemented in the walking skeleton.",
      hint: "Pass a single issue markdown file path until slice 02+ expands target handling.",
    };
    const findings = boundedFindings([finding], input.maxFindings);
    return {
      ok: true,
      summary: summarize(findings, 0, 0),
      findings,
    };
  }

  const resolved = resolve(baseDir, target);

  let stats;
  try {
    stats = statSync(resolved);
  } catch {
    const finding: LocalIssueFinding = {
      severity: "error",
      code: "TARGET_NOT_FOUND",
      path: resolved,
      message: "Target path does not exist.",
      hint: "Check the file path and try again.",
    };
    const findings = boundedFindings([finding], input.maxFindings);
    return {
      ok: false,
      summary: summarize(findings, 0, 0),
      findings,
    };
  }

  if (stats.isDirectory()) {
    const finding: LocalIssueFinding = {
      severity: "warning",
      code: "STUB_DIRECTORY_UNSUPPORTED",
      path: resolved,
      message: "Directory targets are accepted but not implemented in the walking skeleton.",
      hint: "Pass a single issue markdown file path until directory scanning lands in a later slice.",
    };
    const findings = boundedFindings([finding], input.maxFindings);
    return {
      ok: true,
      summary: summarize(findings, 0, 0),
      findings,
    };
  }

  const findings = boundedFindings([], input.maxFindings);
  return {
    ok: true,
    summary: summarize(findings, 1, 1),
    findings,
  };
}

export function formatLintSummary(result: LocalIssueLintResult, targetLabel?: string): string {
  const lines = [
    "Local Issue Lint (walking skeleton)",
    targetLabel ? `Target: ${targetLabel}` : undefined,
    `Scanned: ${result.summary.scanned} | Ready: ${result.summary.ready} | Errors: ${result.summary.errors} | Warnings: ${result.summary.warnings} | Hints: ${result.summary.hints}`,
    result.ok ? "OK" : "FAILED",
  ].filter((line): line is string => line !== undefined);

  if (result.findings.length > 0) {
    lines.push("", "Findings:");
    for (const finding of result.findings) {
      lines.push(`- [${finding.severity}] ${finding.code}: ${finding.message}`);
      lines.push(`  hint: ${finding.hint}`);
    }
  }

  return lines.join("\n");
}

export function emptyLintResult(): LocalIssueLintResult {
  return {
    ok: true,
    summary: { ...EMPTY_SUMMARY },
    findings: [],
  };
}
