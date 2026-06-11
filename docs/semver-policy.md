# Semver Policy

`mcp-kit` uses semantic versioning for every package published from this repo.

## Public API boundary

The following are semver-governed public surface:

- root exports from each published package
- documented CLI commands, flags, JSON output, and exit-code behavior
- generated project structure and managed file contracts
- documented runtime behavior that callers are expected to depend on

The following are not public API:

- deep imports into package internals
- undocumented generated file details
- test-only helpers not exported from package roots
- internal diagnostics or implementation-only comments

## Versioning rules

### Patch

Use a patch release for:

- bug fixes that preserve public contracts
- stricter validation of already-invalid input
- internal refactors with no caller-visible behavior change
- documentation-only fixes

### Minor

Use a minor release for:

- new backward-compatible exports
- new CLI flags that do not change existing behavior
- optional new capabilities behind explicit opt-in

### Major

Use a major release for:

- removing or renaming public exports
- changing documented runtime defaults in a caller-visible way
- changing generated file contracts incompatibly
- changing CLI behavior or JSON output incompatibly

## Required process for breaking changes

Every major or otherwise breaking change must include:

- an entry in [docs/migration-guide.md](./migration-guide.md)
- changelog notes that describe impact at the user level
- verification that release smoke tests still pass for supported packages

Breaking changes must not be introduced through undocumented internal drift.
