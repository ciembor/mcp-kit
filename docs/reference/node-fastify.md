# `@mcp-kit/node/fastify`

Fastify adapter for teams that already own the HTTP server lifecycle and only
want to mount the MCP Streamable HTTP runtime into that process.

## Main Entrypoint

### `registerFastifyStreamableHttp(fastify, createApp, options?)`

Registers MCP routes on an existing Fastify instance.

Use this when:

- another subsystem already owns `fastify.listen()`
- the MCP server must share process lifecycle with other HTTP routes
- you want `mcp-kit` security, auth, and resumability behavior without using
  `runStreamableHttp()`

The function returns `Promise<FastifyStreamableHttpRuntime>`.

## Returned Runtime

### `FastifyStreamableHttpRuntime`

- `options`: normalized `StreamableHttpOptions`
- `drain()`: stop accepting new MCP work and wait for in-flight work
- `close()`: close the MCP runtime mounted inside Fastify

## Fastify Boundary Type

### `FastifyInstanceLike`

Minimal adapter contract required by `registerFastifyStreamableHttp()`:

- `route(definition)`: register MCP GET/POST/DELETE handlers
- `addHook('onClose', handler)`: attach cleanup

This keeps the package loosely coupled to Fastify while still documenting the
shape the adapter expects.

## Relationship To `runStreamableHttp()`

- `runStreamableHttp()` owns the Node HTTP server and port binding.
- `registerFastifyStreamableHttp()` only mounts routes into an existing
  Fastify process.
- Both paths share the same auth, control endpoints, proxy rules, and session
  behavior because they are backed by the same HTTP runtime internals.
