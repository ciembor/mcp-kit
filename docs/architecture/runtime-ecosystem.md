# Runtime Notes

Today, production runtime support is Node.js.

Use `@mcp-kit/core` for application code that should stay portable. Use `@mcp-kit/node` when you need stdio, Streamable HTTP, OAuth resource-server helpers, sessions, resumability, proxy handling, and shutdown behavior on Node.

## Deno, Bun, And Edge Runtimes

There is no first-party `@mcp-kit/web` package yet. The MCP SDK already exposes lower-level Web Standard transport pieces, but `mcp-kit` would need to add more than a renamed wrapper before a new package is worth supporting.

A future non-Node package should give users the same kind of value the Node package gives today: deployment defaults, auth hooks, session or replay storage, lifecycle handling, and tests that do not require application code to change per runtime.

## Express And Hono

There are no first-party Express or Hono adapters yet.

Use `runStreamableHttp()` for a standalone server. If another framework owns the process, mount the existing HTTP handler boundary or use the Fastify adapter when the host is Fastify.

A framework adapter is worth adding when it removes repeated setup that the neutral Node API cannot express cleanly.
