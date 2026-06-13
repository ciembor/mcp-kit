# `@mcp-kit/node/fastify`

Use this subpath when your process already has a Fastify server and MCP should be mounted as another route group.

## `registerFastifyStreamableHttp(fastify, createApp, options?)`

```ts
import { registerFastifyStreamableHttp } from '@mcp-kit/node/fastify'

const runtime = await registerFastifyStreamableHttp(fastify, createApp, {
  mode: 'production',
  path: '/mcp',
  auth: { verifyBearerToken }
})
```

Fastify owns `listen()` and global shutdown. The MCP runtime owns MCP routes, sessions, auth checks, proxy handling, and drain behavior.

## Return Value

| Field     | Use                                                      |
| --------- | -------------------------------------------------------- |
| `options` | Normalized `StreamableHttpOptions`.                      |
| `drain()` | Stop accepting new MCP work and wait for in-flight work. |
| `close()` | Close the mounted MCP runtime.                           |

## Fastify Contract

The adapter needs a Fastify-like object with `route(definition)` and `addHook('onClose', handler)`. That keeps the package lightly coupled while still matching normal Fastify usage.

Use [`runStreamableHttp()`](./node.md) instead when MCP should own the HTTP server and port.
