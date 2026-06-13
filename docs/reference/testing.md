# `@mcp-kit/testing`

Testing helpers for contracts, in-memory app exercise, and stdio integration.

## Package Exports

- `createMcpTestClient()`
- `createInMemoryMcpTestClient()`
- `connectStdioTestClient()`
- `assertPromptContracts()`
- `assertRegistryContracts()`
- `assertResourceContracts()`
- `assertToolContracts()`
- `packageInfo`

## In-Memory Client Helpers

### `createMcpTestClient(app, options?)`

Connects an `McpApp` to an MCP SDK client through linked in-memory transports.

Returns `McpTestClient`:

- `client`: connected SDK client instance
- `close()`: close the client connection

`options` supports:

- `clientInfo?`
- `clientOptions?`

### `createInMemoryMcpTestClient(app, options?)`

Alias for `createMcpTestClient()` kept for clarity at call sites.

## Stdio Client Helper

### `connectStdioTestClient(server, clientInfo?)`

Starts a real stdio client transport against a spawned server process.

Returns `StdioTestClient`:

- `client`: connected SDK client
- `transport`: stdio transport instance
- `stderr()`: buffered stderr output from the server process
- `protocolVersion()`: last negotiated MCP protocol revision
- `close()`: close the client transport

Use this helper for black-box tests that should exercise the real stdio
transport, process startup, and protocol negotiation.

## Contract Assertions

- `assertPromptContracts()`
- `assertRegistryContracts()`
- `assertResourceContracts()`
- `assertToolContracts()`

Use these to verify shape and semantic expectations of your exported
capabilities in tests without rebuilding the assertions yourself.

## Metadata And Types

- `packageInfo`
- `McpTestClient`
- `StdioTestClient`
