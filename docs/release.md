# Release

This page is for maintainers publishing `mcp-kit` packages.

## Prepare

Work from `main`. Update the root version, every published workspace package version, and `CHANGELOG.md` together.

Run the local release check before publishing:

```sh
pnpm --filter @mcp-kit/cli build
pnpm exec mcp-kit release
```

The release check builds packages, runs the release quality pipeline, packs packages, installs them in isolation, and runs import, type, CLI, stdio, and HTTP smoke checks.

## Publish

Publish through GitHub Actions:

```txt
GitHub Actions -> Release workflow -> Run workflow
```

The workflow runs `pnpm exec mcp-kit release --publish` and publishes with npm provenance through GitHub OIDC trusted publishing. Each published package on npm must trust the repository's `release.yml` workflow.

Do not publish with the placeholder version `0.0.0`.

## Roll Back

If publishing failed before anything reached npm, fix the issue and rerun the workflow from `main`.

If a broken version is already on npm, deprecate it, fix or revert the change, bump to a new version, update the changelog, and publish again. npm package versions are immutable, so do not plan on reusing a version.
