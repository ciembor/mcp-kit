# Semver

`mcp-kit` uses semantic versioning for published packages.

Public API includes package root exports, documented subpaths, CLI commands and flags, generated project contracts, and documented runtime behavior.

Internal files under `src/**`, undocumented generated details, test-only internals, and implementation comments are not public API.

| Release | Use it for                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Patch   | Bug fixes, documentation fixes, stricter rejection of already-invalid input, and internal refactors with no caller-visible behavior change. |
| Minor   | New exports, new optional CLI flags, and new capabilities that existing users do not opt into automatically.                                |
| Major   | Removed or renamed exports, incompatible generated files, changed runtime defaults, or incompatible CLI output and exit behavior.           |

Breaking changes need changelog notes and migration notes that explain the user impact and the validation command to run after upgrading.
