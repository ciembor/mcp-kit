# `create-mcp-kit`

Programmatic and `npm create` entrypoint for scaffolding official `mcp-kit`
projects.

## Package Exports

- `runCreateMcpKit()`
- `createMcpKitProject()`
- `findTemplateDirectory()`
- `toPackageName()`
- `errorMessage()`
- `packageInfo`

## Main Entrypoints

### `runCreateMcpKit(args?)`

Runs the `npm create mcp-kit` entrypoint.

Behavior:

- expects a project directory argument
- writes status and failures to stderr
- returns numeric process status instead of exiting directly

### `createMcpKitProject(projectPath, options?)`

Copies the official template into a target directory, restores bundled test
filenames, and replaces template tokens.

`CreateMcpKitOptions`:

- `cwd?`
- `corePackage?`
- `nodePackage?`
- `cliPackage?`
- `testingPackage?`
- `templateDirectory?`

The function returns the absolute target path.

## Utility Exports

### `findTemplateDirectory()`

Resolves the bundled template from a list of candidate locations.

### `toPackageName()`

Normalizes generated package names from a directory or user-supplied value.

### `errorMessage()`

Converts unknown thrown values into stable error text for CLI surfaces.

### `packageInfo`

Published package metadata with stable `name` and `version` fields.

## What The Generator Guarantees

- target path must stay inside the requested root
- target directory must be empty or missing
- the official template is the source of truth unless a custom template
  directory is passed explicitly
- generated package names are normalized through `toPackageName()`

Start with the end-user flow in the [tutorial](../tutorial).
