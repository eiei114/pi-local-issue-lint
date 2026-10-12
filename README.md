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

## Install (local dogfood)

From a clone of this repository:

```bash
npm install
pi -e .
```

From GitHub without publishing:

```bash
pi install git:github.com/eiei114/pi-local-issue-lint
```

Install into the current project instead of user Pi settings:

```bash
pi install git:github.com/eiei114/pi-local-issue-lint -l
```

## Quick start

Run the human command from a project or vault folder (or pass a target explicitly):

```txt
/local-issue-lint:check Issues
```

For example, lint the authoring folders used by the OSS import workflow and Incubator Stage B:

```txt
/local-issue-lint:check 4_Project/OSS/to-multica-issues-for-oss/Issues
/local-issue-lint:check "4_Project/Incubator/Stage B"
```

The command detects the target's project folder and checks an ancestor `managed-projects.md` when present. Unregistered project keys and disabled import mappings are warnings; local lint remains usable without a registry or Multica auth.

Agents can call the tool directly:

```json
{
  "target": "Issues/01-walking-skeleton-lint-command.md"
}
```

Example result:

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

## Release

The package version is 0.1.0 and remains unpublished. Publishing is human-owned after slice 06 release prep.

## Security

This extension reads local files only. It does not call Multica APIs, mutate issues, or write files.

## Links

- GitHub: https://github.com/eiei114/pi-local-issue-lint
- Vault design docs: `4_Project/OSS/pi-local-issue-lint/` in the Obsidian vault

## License

MIT
