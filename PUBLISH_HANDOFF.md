## Human-owned first publish

This branch prepares `pi-local-issue-lint@0.1.1` for review; it does not publish the package, create a release/tag, dispatch a workflow, or handle credentials. Publishing and any npm OTP challenge are human-owned.

After this PR is merged, the maintainer should:

1. Review the merged `main` contents and confirm the version, packed file list, package name, and public visibility are correct. Verify the npm package name and account ownership before publishing; the first public release is effectively irreversible to users.
2. Confirm GitHub Actions Trusted Publishing is configured for this repository and `.github/workflows/publish.yml`, and that the npm account is authorized to publish `pi-local-issue-lint`.
3. From an authenticated GitHub CLI session, explicitly start the guarded release workflow:

   ```bash
   gh workflow run auto-release.yml --ref main -f confirm_release=true
   ```

   This manual confirmation creates the `v0.1.1` tag and GitHub release when the version check passes, then starts `publish.yml`. That workflow validates the package and runs `npm publish --access public` using GitHub OIDC Trusted Publishing.

The normal workflow should not need a local npm token or OTP. If npm requests an OTP or interactive registry authentication, the maintainer must handle it directly; never share OTPs or tokens with an agent. Do not dispatch the release workflow until the PR is merged and the maintainer has inspected the exact package contents. A version already present on npm is skipped by the workflow; unexpected registry responses or a failed Trusted Publishing configuration stop publication.

## Dogfood evidence and known limitations

- The local `Issues/` folder was scanned without changing its files: 6 Markdown files, 0 import-ready, 12 errors, 1 warning, and 5 informational hints. The completed historical issues are intentionally `ready_for_multica: false` and use `status: done`, which the import-readiness lint reports as non-importable. The current release-prep issue also reports the declared npm publish intent as a warning and its OTP wording as a protected-boundary finding.
- Actual Pi CLI command checks loaded the extension and exited naturally within the 15-second deadline: a valid temporary fixture printed `Scanned: 1 | Ready: 1 | Errors: 0 | Warnings: 0 | Hints: 0` and `OK`; an intentionally invalid fixture printed `FRONTMATTER_MISSING` and `FAILED`. The isolated config, temporary files, and no-session Pi processes were cleaned up.
- The protected-operation check is a conservative keyword check. Policy descriptions and historical text that mention guarded operations can produce findings; inspect context rather than treating every match as an instruction or an attempted action.
- `npm run ci` passed (46 passed, 1 platform-dependent skip); it covers missing frontmatter/sections, missing dependencies and cycles, stacked metadata, version policy, and protected-operation prose. `npm pack --dry-run` and `npm publish --dry-run --access public` both packaged `pi-local-issue-lint@0.1.1` successfully. This package does not edit files or contact Multica.
