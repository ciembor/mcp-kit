# ADR 0001: Stateless-First Streamable HTTP

`@mcp-kit/node` defaults to stateless Streamable HTTP for production.

Stateful sessions are still supported, but only as a single-process choice. The underlying MCP transport keeps session state in memory, so `mcp-kit` does not model stateful HTTP as a cross-instance production feature.

The result for users is straightforward:

| Need                               | Use                                                        |
| ---------------------------------- | ---------------------------------------------------------- |
| Normal production HTTP             | `sessionMode: 'stateless'` or the default.                 |
| Session continuity across requests | `sessionMode: 'stateful'` in a single process.             |
| Event replay after reconnect       | `eventStore` with durable storage.                         |
| Local tests and demos              | In-memory stores from `@mcp-kit/node`.                     |

The runtime still validates auth on every request. Reusing a session never replaces authorization.
