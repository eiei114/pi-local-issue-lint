# Changelog

## [0.1.3] - Unreleased

### Changed

- Upgrade the pinned Pi SDK development dependencies to 1.3.0 and verify against the actual Pi host.
- Bump the package patch version to 0.1.3 for the SDK compatibility update.

## [0.1.2] - 2026-10-16

### Changed

- Pin the Pi SDK development dependencies to 1.2.0 and update actual-host smoke verification.
- Bump the package patch version to 0.1.2.

## [0.1.1] - 2026-10-13

### Changed

- Pin the Pi SDK development dependencies to 1.1.0 and verify the extension against the real Pi host.
- Require Node.js 22.19.0 or later to match the Pi SDK 1.1.0 runtime.
- Bump the package patch version to 0.1.1.
- Document npm and Git installation, Pi tool/command usage, the JSON result contract, human hints, and read-only limitations.
- Add a human-owned first-publish handoff; no package publication is performed by this release-prep change.

## [0.1.0] - 2026-10-12

### Added

- Discover project folders and optionally add read-only `managed-projects.md` registry hints.
- Lint draft and unregistered issue folders, with concise findings grouped by file and severity.
- Document OSS import and Incubator Stage B authoring examples.

### Fixed

- Keep registry lookup scoped to the target and preserve directory-read errors when excluding drafts.
- Prioritize errors in concise summaries and require explicit manual confirmation before release.

## [0.0.1] - 2026-09-30

### Changed

- Update `@earendil-works/pi-*` dependencies to `0.99.1`.

## [0.0.0] - 2026-09-15

### Added

- Walking skeleton `local_issue_lint` tool with TypeBox schema and stub JSON contract (`ok`, `summary`, `findings`).
- `/local-issue-lint:check` command for human-readable stub summaries.
- Single-file stub lint behavior; directory and glob targets return stub warnings.
