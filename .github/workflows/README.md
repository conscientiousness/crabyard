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

1. Set the release version in `package.json` and `src/shared.ts`, for example `2026.4.1`.
2. Run `pnpm run release:check`.
3. Commit the release version.
4. Push a matching tag such as `v2026.4.1`.
5. GitHub Actions validates the tag/version match, publishes to npm, and creates the GitHub release.

Before the first real publish, configure npm trusted publishing for this repository on npmjs.com.
