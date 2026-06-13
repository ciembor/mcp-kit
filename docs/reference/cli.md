# `@mcp-kit/cli`

`@mcp-kit/cli` powers the `mcp-kit` command and exposes a small programmatic API for tools that need the same project checks.

## Commands

| Command           | Use                                                           |
| ----------------- | ------------------------------------------------------------- |
| `mcp-kit new`     | Create a new project from the official template.              |
| `mcp-kit init`    | Add or refresh managed project files.                         |
| `mcp-kit add`     | Generate a tool, prompt, or resource and update the registry. |
| `mcp-kit doctor`  | Inspect project shape and report diagnostics.                 |
| `mcp-kit quality` | Run quality checks using the project quality config.          |
| `mcp-kit release` | Run the release gate before publishing packages.              |

Day to day, prefer the scripts generated in your project. Use the CLI package directly when another Node process needs to run the same checks.

## Exports

| Export                   | Use                                                                  |
| ------------------------ | -------------------------------------------------------------------- |
| `runCli(args, io?)`      | Run the CLI in-process and receive a `CliResult` instead of exiting. |
| `analyzeProject()`       | Reuse the project analysis behind `doctor` and `quality`.            |
| `defineQualityConfig()`  | Type a project `quality.config.*` file.                              |
| `loadQualityConfig()`    | Load config from disk.                                               |
| `resolveQualityConfig()` | Merge defaults, presets, and project config.                         |
| `runQuality()`           | Run the quality pipeline from Node code.                             |
| `executeCommand()`       | Low-level process runner used by quality steps.                      |
| `packageInfo`            | Published package name and version.                                  |
| `exitCodes`              | Stable exit-code values used by the CLI.                             |

## Main Types

| Area               | Types                                                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI                | `CliIo`, `CliResult`, `ExitCode`, `DoctorDiagnostic`                                                                                                                         |
| Project generation | `FileOperation`, `FileOperationKind`, `FilePlan`, `PackageManager`, `ProjectLanguage`, `TransportPreset`, `AgentPreset`                                                      |
| Quality            | `QualityConfig`, `ResolvedQualityConfig`, `QualityMode`, `QualityPreset`, `QualityReport`, `QualityStepResult`, `CoverageThresholds`, `CoverageExclusion`, `QualityExecutor` |
| JSON               | `JsonObject`, `JsonValue`                                                                                                                                                    |

Use `runQuality()` before reaching for `executeCommand()`. The lower-level runner is mainly useful when extending the quality engine itself.
