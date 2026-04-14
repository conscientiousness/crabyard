# GitHub Workflows

## CI

`ci.yml` runs the release baseline on every PR and on `main`:

- install with a frozen lockfile
- build
- test
- smoke test the built CLI
- verify the npm tarball with `npm pack --dry-run`

## Release

`release-prepare.yml` publishes from a pushed CalVer tag.

Expected flow:

1. Set the release version in `package.json` and `src/shared.ts`, for example `2026.4.1`, `2026.4.1-1` (same-day follow-up release), or `2026.4.1-beta.1`.
2. Run `pnpm run release:check`.
3. Commit the release version.
4. Push a matching tag such as `v2026.4.1` or `v2026.4.1-1` on the current `main` HEAD commit.
5. GitHub Actions validates the tag format, version match, and `main` HEAD requirement before publishing to npm and creating the GitHub release.

For multiple releases on the same day, increment the suffix (`-1`, `-2`, `-3`) in both
`package.json` and `src/shared.ts`, then tag with the same suffixed form.
Numeric follow-up releases such as `2026.4.13-1` publish under `latest`.
Only `-beta` releases such as `2026.4.13-beta.1` publish under the `next` dist-tag.

Before the first real publish, configure npm trusted publishing for this repository on npmjs.com.

Both workflows pin third-party actions to full commit SHAs, with the audited release version noted in comments for updates.
