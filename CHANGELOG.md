# Changelog

## [Unreleased]

- Added `quality --release` checks for clean git state, package version consistency, changelog presence, package exports, published file coverage, `npm pack --dry-run` for each published package, isolated tarball installation with rewritten workspace dependencies, consumer smoke tests for imports, types, and CLI entrypoints, plus stdio and HTTP smoke for packed framework tarballs.
- Added `mcp-kit release` as a prepare-only command that runs the release quality gate without publishing.
- Added explicit `mcp-kit release --publish` support that only publishes after the release quality gate passes.
- Added a root `prepublishOnly` script that rebuilds the CLI entrypoint and enforces `mcp-kit quality --release` before publishing.
- Added a manual GitHub Actions release workflow that installs dependencies, builds the CLI, and runs `mcp-kit release --publish`.
- Added npm provenance to release publishing and switched the release workflow to GitHub OIDC trusted publishing instead of an npm token.
- Added release publish guards that refuse publishing outside `main` or while the root package version is still the `0.0.0` placeholder.
