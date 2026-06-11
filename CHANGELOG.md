# Changelog

## [Unreleased]

- Added `quality --release` checks for clean git state, package version consistency, changelog presence, package exports, published file coverage, `npm pack --dry-run` for each published package, isolated tarball installation with rewritten workspace dependencies, consumer smoke tests for imports, types, and CLI entrypoints, plus stdio and HTTP smoke for packed framework tarballs.
- Added `mcp-kit release` as a prepare-only command that runs the release quality gate without publishing.
- Added explicit `mcp-kit release --publish` support that only publishes after the release quality gate passes.
- Added a root `prepublishOnly` script that rebuilds the CLI entrypoint and enforces `mcp-kit quality --release` before publishing.
