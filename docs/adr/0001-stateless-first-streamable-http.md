# ADR 0001: Stateless-First Streamable HTTP

`@mcp-kit/node` defaults to stateless Streamable HTTP for production.

Stateful sessions are still supported, but they are an explicit choice and need a `SessionStore` outside the process. This avoids making sticky sessions or local memory part of the correctness model.

The result for users is straightforward:

| Need                               | Use                                                        |
| ---------------------------------- | ---------------------------------------------------------- |
| Normal production HTTP             | `sessionMode: 'stateless'` or the default.                 |
| Session continuity across requests | `sessionMode: 'stateful'` with an external `SessionStore`. |
| Event replay after reconnect       | `eventStore` with durable storage.                         |
| Local tests and demos              | In-memory stores from `@mcp-kit/node`.                     |

The runtime still validates auth on every request. Reusing a session never replaces authorization.
