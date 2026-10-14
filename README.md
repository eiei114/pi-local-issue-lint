# pi-local-issue-lint

[![CI](https://github.com/eiei114/pi-local-issue-lint/actions/workflows/ci.yml/badge.svg)](https://github.com/eiei114/pi-local-issue-lint/actions/workflows/ci.yml)
[![Publish](https://github.com/eiei114/pi-local-issue-lint/actions/workflows/publish.yml/badge.svg)](https://github.com/eiei114/pi-local-issue-lint/actions/workflows/publish.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Pi package](https://img.shields.io/badge/pi-package-purple.svg)](https://pi.dev/packages)

> Read-only lint for Multica Local Markdown Issues before import.

## What this is

`pi-local-issue-lint` checks issue files and project folders before import. It validates frontmatter, body sections, dependencies, PR/version policy, and optional project-registry metadata without contacting Multica or modifying files.

## Features

- `local_issue_lint` Pi tool and `/local-issue-lint:check` human command
- File, directory, and glob targets, including drafts and unregistered project folders
- Optional read-only hints from an ancestor `managed-projects.md`; no Multica credentials required
- Stable JSON contract: `ok`, `summary`, `findings`; human output groups concise hints by file and severity
- Read-only: no import, no Multica mutation, no auto-fix

## Install

After the human-owned npm publish, install the package with Pi:

```bash
pi install npm:pi-local-issue-lint
```

The npm package is not published yet. Until the maintainer completes the publish handoff, install the current source from GitHub:

```bash
pi install git:github.com/eiei114/pi-local-issue-lint
```

For local development or dogfooding from a clone:

From a clone of this repository:

```bash
npm install
pi -e .
```

Use `-l` to install the GitHub source into the current project instead of user Pi settings:

```bash
pi install git:github.com/eiei114/pi-local-issue-lint -l
```

## Human command

Run the human command from a project or vault folder (or pass a target explicitly):

```txt
/local-issue-lint:check Issues
```

For example, lint the authoring folders used by the OSS import workflow and Incubator Stage B:

```txt
/local-issue-lint:check 4_Project/OSS/to-multica-issues-for-oss/Issues
/local-issue-lint:check "4_Project/Incubator/Stage B"
```

The command prints a concise, human-readable summary. It detects the target's project folder and checks an ancestor `managed-projects.md` when present. Unknown project keys and disabled import mappings are warnings; lint still works without a registry or Multica authentication.

## Pi tool and JSON output

Pi agents can call the `local_issue_lint` tool with a file, directory, or glob target. For example, ask Pi to lint the folder with:

```json
{
  "target": "Issues/01-walking-skeleton-lint-command.md"
}
```

The tool returns the complete JSON result (unlike the shorter human command output):

```json
{
  "ok": true,
  "summary": {
    "scanned": 1,
    "ready": 1,
    "errors": 0,
    "warnings": 0,
    "hints": 0
  },
  "findings": []
}
```

`ok` is false when at least one error finding exists. Each finding includes a severity, stable code, path, message, and actionable hint; `docs_ref` and `location` are included when available. Summary counts cover all findings even when an optional `maxFindings` limit truncates the returned list.

## Examples

### Missing dependency

Before: the folder contains `04-pr-and-version-policy-checks.md`, but the issue refers to a non-existent stem.

```yaml
blocked_by:
  - 04-pr-mode-and-version-policy-checks
```

The lint reports `DEPENDENCY_MISSING` with a hint to use an existing filename stem or relative path. Correct it to match the issue that is actually in the folder:

```yaml
blocked_by:
  - 04-pr-and-version-policy-checks
```

For an intentionally blocked issue, use `status: blocked`; unresolved dependencies are then warnings rather than hard errors.

### Version bump mismatch

Before: `version_bump_required: false` conflicts with `version_bump_type: patch` and produces `VERSION_BUMP_NOT_REQUIRED`.

```yaml
version_bump_required: false
version_bump_type: patch
```

After: align the fields with the change policy, and include the required files in the acceptance criteria when a bump is required.

```yaml
version_bump_required: true
version_bump_type: patch
```

For a required bump, the acceptance criteria should also name the artifacts:

```markdown
## Acceptance criteria
- [ ] Update `package.json`, `package-lock.json`, and `CHANGELOG.md`.
```

The lint reports the policy mismatch and reminds authors to list `package.json` and `CHANGELOG.md` in the acceptance criteria for a required bump. It does not change package versions or publish anything. Hints include the canonical `local-issue-import-format-v1` or `managed-projects.md` reference where applicable.

## Package contents

| Path | Purpose |
|---|---|
| `lib/lint.ts` | Shared read-only lint core |
| `extensions/index.ts` | Pi tool and slash command registration |

## Development

```bash
npm install
npm run ci
```

`npm run ci` includes `npm run smoke:pi`, which starts the locally pinned Pi 1.1.0 host and executes this extension's lint tool. The smoke uses a deterministic offline provider (no paid inference) while keeping Pi's extension loading, tool execution, error handling, second-process cleanup, and native-shell version check real.

## Release

The package remains unpublished until the maintainer completes `PUBLISH_HANDOFF.md`. Publishing and any registry authentication or OTP challenge are human-owned.

## Security

This extension reads local Markdown files and an optional ancestor `managed-projects.md` only. It does not call Multica APIs, mutate issues, or write/auto-fix files. No Multica credentials are required.

## Limitations

- This is an import-readiness lint, not a validator for every Markdown convention. It checks dependencies only among the files selected by the target and recognizes `ready`, `blocked`, and `draft` as import statuses; historical issues marked `done` are reported as non-importable.
- Registry lookup is optional and local. It does not confirm live project state or resolve Multica issue IDs.
- The human command limits displayed findings to ten; use the tool for the complete JSON result.
- Protected-operation checks are intentionally conservative keyword checks. Policy documentation that discusses publishing, OTP, secrets, or other guarded operations may also produce findings; review the surrounding text before treating one as an actionable violation.
- The tool does not edit issues, run imports, publish packages, or replace human review of findings.

## Links

- GitHub: https://github.com/eiei114/pi-local-issue-lint
- Vault design docs: `4_Project/OSS/pi-local-issue-lint/` in the Obsidian vault

## License

MIT
