# pi-local-issue-lint

[![CI](https://github.com/eiei114/pi-local-issue-lint/actions/workflows/ci.yml/badge.svg)](https://github.com/eiei114/pi-local-issue-lint/actions/workflows/ci.yml)
[![Publish](https://github.com/eiei114/pi-local-issue-lint/actions/workflows/publish.yml/badge.svg)](https://github.com/eiei114/pi-local-issue-lint/actions/workflows/publish.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Pi package](https://img.shields.io/badge/pi-package-purple.svg)](https://pi.dev/packages)

> Read-only lint for Multica Local Markdown Issues before import.

## What this is

`pi-local-issue-lint` gives issue authors a visible lint surface before real policy checks exist. Slice 01 is a walking skeleton: single-file targets return a stable stub JSON contract; directory and glob targets are accepted but not implemented yet.

## Features

- `local_issue_lint` Pi tool with a TypeBox schema
- `/local-issue-lint:check` human command that prints a readable stub summary
- Stable JSON contract: `ok`, `summary`, `findings`
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

Run the human command:

```txt
/local-issue-lint:check
```

Pi prompts for an issue markdown file path. The command prints a stub summary such as:

```txt
Local Issue Lint (walking skeleton)
Target: Issues/01-walking-skeleton-lint-command.md
Scanned: 1 | Ready: 1 | Errors: 0 | Warnings: 0 | Hints: 0
OK
```

Agents can call the tool directly:

```json
{
  "target": "Issues/01-walking-skeleton-lint-command.md"
}
```

Example stub result:

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

This package is pre-0.1.0. Publishing is human-owned after slice 06 release prep.

## Security

This extension reads local files only. It does not call Multica APIs, mutate issues, or write files.

## Links

- GitHub: https://github.com/eiei114/pi-local-issue-lint
- Vault design docs: `4_Project/OSS/pi-local-issue-lint/` in the Obsidian vault

## License

MIT
