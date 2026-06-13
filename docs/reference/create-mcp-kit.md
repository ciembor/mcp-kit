# `create-mcp-kit`

`create-mcp-kit` is the package behind:

```sh
corepack pnpm create mcp-kit my-server
```

Most users only need the command. Use the programmatic API when another tool has to scaffold the same project template.

## Exports

| Export                                       | Use                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| `runCreateMcpKit(args?)`                     | Run the `npm create mcp-kit` entrypoint and return a numeric status.            |
| `createMcpKitProject(projectPath, options?)` | Copy the official template into a target directory and replace template tokens. |
| `findTemplateDirectory()`                    | Locate the bundled template.                                                    |
| `toPackageName()`                            | Convert a directory or user value into a valid package name.                    |
| `errorMessage()`                             | Convert unknown thrown values into CLI-safe text.                               |
| `packageInfo`                                | Published package name and version.                                             |

## `createMcpKitProject(projectPath, options?)`

The target directory must be missing or empty. The generated package name is normalized from the directory unless you pass another value through the template options.

`CreateMcpKitOptions` supports `cwd`, package version overrides, and `templateDirectory` for tests or custom scaffolding.

The function returns the absolute target path.
