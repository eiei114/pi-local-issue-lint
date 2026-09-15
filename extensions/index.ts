import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  formatLintSummary,
  localIssueLint,
  type LocalIssueLintInput,
  type LocalIssueLintResult,
} from "../lib/lint.ts";

const localIssueLintParameters = Type.Object({
  target: Type.String({
    description: "Local issue markdown file, directory, or glob target.",
  }),
  projectRoot: Type.Optional(
    Type.String({
      description: "Project or vault root used to resolve relative targets.",
    }),
  ),
  policyPreset: Type.Optional(
    StringEnum(["multica-local-issue-v1"] as const, {
      description: "Policy preset for Multica local issue format v1.",
    }),
  ),
  includeDrafts: Type.Optional(
    Type.Boolean({
      description: "Include draft issues when scanning directories (stub only in slice 01).",
    }),
  ),
  maxFindings: Type.Optional(
    Type.Number({
      description: "Maximum number of findings to return.",
      minimum: 0,
    }),
  ),
  outputMode: Type.Optional(
    StringEnum(["compact", "full"] as const, {
      description: "Output verbosity for future slices.",
    }),
  ),
});

export default function (pi: ExtensionAPI) {
  pi.registerCommand("local-issue-lint:check", {
    description: "Run read-only local issue lint and print a stub summary",
    handler: async (_args, ctx) => {
      let target: string | undefined;
      if (ctx.hasUI) {
        target = await ctx.ui.input("Issue file path (leave blank to cancel):", "");
        if (target === undefined) {
          return;
        }
      }

      const trimmed = target?.trim() ?? "";
      if (!trimmed) {
        if (ctx.hasUI) {
          ctx.ui.notify("local-issue-lint check cancelled", "info");
        }
        return;
      }

      const result = localIssueLint({ target: trimmed });
      const summary = formatLintSummary(result, trimmed);
      console.log(summary);
      if (ctx.hasUI) {
        ctx.ui.notify(
          result.ok ? "local-issue-lint check passed (stub)" : "local-issue-lint check failed",
          result.ok ? "info" : "error",
        );
      }
    },
  });

  pi.registerTool({
    name: "local_issue_lint",
    label: "Local Issue Lint",
    description: "Read-only lint for Multica Local Markdown Issue files (walking skeleton stub).",
    promptSnippet: "local_issue_lint: lint a local issue markdown file before Multica import",
    promptGuidelines: [
      "Use local_issue_lint before import when validating Local Markdown Issue authoring.",
      "This slice only implements single-file stub behavior; directory and glob targets return stub warnings.",
    ],
    parameters: localIssueLintParameters,
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      if (signal?.aborted) {
        return { content: [{ type: "text", text: "Cancelled" }], details: emptyDetails() };
      }

      const result = localIssueLint(params as LocalIssueLintInput);
      const text = JSON.stringify(result, null, 2);

      return {
        content: [{ type: "text", text }],
        details: result,
      };
    },

    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("local_issue_lint "));
      text += theme.fg("accent", `target=${args.target}`);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme, _context) {
      const details = result.details as LocalIssueLintResult | undefined;
      const status = details?.ok ? theme.fg("success", "OK") : theme.fg("error", "FAILED");
      let text = `${status} ${theme.fg("text", formatLintSummary(details ?? { ok: false, summary: { scanned: 0, ready: 0, errors: 1, warnings: 0, hints: 0 }, findings: [] }))}`;
      if (expanded && details) {
        text += `\n${theme.fg("dim", JSON.stringify(details.summary))}`;
      }
      return new Text(text, 0, 0);
    },
  });
}

function emptyDetails(): LocalIssueLintResult {
  return {
    ok: true,
    summary: { scanned: 0, ready: 0, errors: 0, warnings: 0, hints: 0 },
    findings: [],
  };
}
