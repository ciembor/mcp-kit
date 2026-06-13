# `@mcp-kit/testing`

`@mcp-kit/testing` helps tests talk to your app like an MCP client.

## Exports

| Export                          | Use                                                                    |
| ------------------------------- | ---------------------------------------------------------------------- |
| `createMcpTestClient()`         | Connect an `McpApp` to an SDK client through in-memory transports.     |
| `createInMemoryMcpTestClient()` | Alias for `createMcpTestClient()` when the name reads better in tests. |
| `connectStdioTestClient()`      | Start a real stdio client against a spawned server process.            |
| `assertPromptContracts()`       | Check prompt definitions.                                              |
| `assertRegistryContracts()`     | Check a registry.                                                      |
| `assertResourceContracts()`     | Check resource definitions.                                            |
| `assertToolContracts()`         | Check tool definitions.                                                |
| `packageInfo`                   | Published package name and version.                                    |

## In-Memory Client

```ts
import { createMcpTestClient } from '@mcp-kit/testing'
import { app } from '../src/app.js'

const testClient = await createMcpTestClient(app)
```

The returned object contains `client` and `close()`. Use this for fast behavior tests where the transport itself is not the subject.

## Stdio Client

`connectStdioTestClient(server, clientInfo?)` starts a real stdio transport against a child process. The return value includes `client`, `transport`, `stderr()`, `protocolVersion()`, and `close()`.

Use it when the test should cover process startup, stdio wiring, stderr output, or protocol negotiation.

## Contract Assertions

Contract assertions are useful next to exported registries. They catch broken names, schemas, metadata, and handler contracts without forcing tests to know private implementation details.
