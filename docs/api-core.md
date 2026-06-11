# `@mcp-kit/core` API Reference

`@mcp-kit/core` defines the transport-independent public contract for building
MCP servers with `mcp-kit`.

## Public entrypoints

### App assembly

- `createMcpApp(options)`
- `McpApp`
- `McpAppOptions`

Use `createMcpApp()` to assemble tools, resources, and prompts without binding
to a concrete runtime. Transport wiring belongs in outer packages such as
`@mcp-kit/node`.

### Capability definitions

- `defineTool(options)`
- `defineResource(options)`
- `definePrompt(options)`
- `defineRegistry(items)`

These functions define the stable contracts that application code owns.

### Request and policy types

- `RequestContext`
- `ToolDefinition`
- `ToolOptions`
- `ToolPolicy`
- `CapabilityPolicy`
- `PromptDefinition`
- `ResourceDefinition`
- `StaticResourceDefinition`
- `TemplateResourceDefinition`
- `AnyResourceDefinition`
- `RegistryItem`
- `Schema`
- `InferSchemaOutput`

`RequestContext` is the main application boundary. It exposes:

- stable request metadata such as `requestId` and `signal`
- injected `services`
- a transport-independent logger
- authenticated subject and tenant context when available
- client capability helpers for progress, roots, sampling, and elicitation

### Client capability helpers

`RequestContext.client` exposes the following public helpers:

- `client.roots`
- `client.sampling`
- `client.elicitation`

These helpers intentionally hide SDK capability checks and convert unsupported
operations into stable `McpKitError` behavior.

### Runtime utilities

- `silentLogger`
- `timeoutAbortError()`
- `trackProtocolVersion()`
- `ToolMiddleware`
- `ToolMiddlewareArgs`

These are public because outer runtime packages and advanced callers may need
to extend middleware or transport behavior without reimplementing the core
pipeline.

### Errors and metadata

- `McpKitError`
- `packageInfo`

`McpKitError` is the stable application error shape for safe messages and
internal causes.

### Completion helpers

- `completable()`
- `getCompleter()`
- `isCompletable()`
- `unwrapCompletable()`
- `CompleteCallback`
- `CompletableSchema`

These are re-exported because completion is part of the public definition
surface for prompts and resources.

## Stability notes

- Anything exported from `@mcp-kit/core` root is part of the public API.
- Internal files under `src/app`, `src/definitions`, and `src/runtime` are not
  public import targets.
- New capability helpers should be added to `RequestContext.client` only when
  they reduce caller complexity more than they increase public surface.
