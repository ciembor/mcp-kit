# `@mcp-kit/cli`

Workspace-facing CLI library for generation, diagnostics, analysis, quality,
and release preparation.

## Package Exports

- `runCli()`
- `analyzeProject()`
- `defineQualityConfig()`
- `loadQualityConfig()`
- `resolveQualityConfig()`
- `runQuality()`
- `executeCommand()`
- `packageInfo`
- `exitCodes`

## Main Runtime Entrypoint

### `runCli(args, io?)`

Executes the CLI programmatically and returns a structured result instead of
exiting the process directly.

Use this when another Node process should embed the CLI without shelling out.
All command parsing, diagnostics, and formatted output stay inside the package.

## Analysis API

- `analyzeProject()`
- `ProjectAnalysis`
- `ProjectDiagnostic`

Use this surface when another tool needs the same project-structure and rule
analysis that powers `doctor` and `quality`.

## Quality API

- `defineQualityConfig()`
- `loadQualityConfig()`
- `resolveQualityConfig()`
- `runQuality()`
- `executeCommand()`

Main config and report types:

- `QualityConfig`
- `ResolvedQualityConfig`
- `QualityMode`
- `QualityPreset`
- `QualityReport`
- `QualityStepResult`
- `CoverageThresholds`
- `CoverageExclusion`
- `QualityExecutor`

`executeCommand()` is the lowest-level process runner used by the quality
pipeline. Prefer `runQuality()` unless you are extending the quality engine
itself.

## CLI Support Contracts

- `packageInfo`
- `exitCodes`
- `CliIo`
- `CliResult`
- `ExitCode`
- `DoctorDiagnostic`
- `FileOperation`
- `FileOperationKind`
- `FilePlan`
- `JsonObject`
- `JsonValue`
- `PackageManager`
- `ProjectLanguage`
- `TransportPreset`
- `AgentPreset`

`exitCodes` defines the stable process contract used by the CLI binary and
`runCli()` callers.

## Command Overview

The main user-facing commands are:

- `mcp-kit new`
- `mcp-kit init`
- `mcp-kit add`
- `mcp-kit doctor`
- `mcp-kit quality`
- `mcp-kit release`

Use the generated project-local scripts for day-to-day work, and keep the CLI
package as the authoritative source of workspace generation and quality policy.
