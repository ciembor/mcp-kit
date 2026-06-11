# Release and Rollback

## Standard release path

1. Work only from `main`. `mcp-kit release --publish` now refuses any other branch.
2. Bump the root version and every published workspace package version together. Do not publish with the placeholder `0.0.0`.
3. Update `CHANGELOG.md` for the target version.
4. Run the prepare gate locally:

```sh
pnpm --filter @mcp-kit/cli build
pnpm exec mcp-kit release
```

This runs the full `quality --release` pipeline, including package build, `npm pack`, isolated installation, import/type/CLI smoke tests, and stdio/HTTP tarball smoke checks.

5. Publish through the official CI path:

```txt
GitHub Actions -> Release workflow -> Run workflow
```

The workflow:

- installs dependencies with pnpm
- builds the CLI entrypoint
- runs `pnpm exec mcp-kit release --publish`
- publishes with npm provenance through GitHub OIDC trusted publishing

6. Verify the published versions on npm and confirm the generated provenance attestation is present.

## Trusted publisher setup

Configure each published package on npmjs.com to trust the GitHub Actions workflow file `release.yml` in this repository. The workflow already requests `id-token: write`; no long-lived `NPM_TOKEN` should be required for normal publishing.

## Rollback

If the workflow fails before any package is published:

- fix the failing step
- rerun the workflow from `main`
- keep the version only if nothing reached the registry

If a broken version is already published:

- prefer `npm deprecate <package>@<version> "reason and replacement version"` over unpublishing
- revert or fix the bad change on `main`
- bump to a new version
- update `CHANGELOG.md`
- publish the replacement through the same release workflow

Only unpublish when the npm unpublish policy allows it. npm treats published versions as immutable: a `name@version` can never be reused, even after unpublish.
