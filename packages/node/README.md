# @mcp-kit/node

Node.js transport and process lifecycle integration for mcp-kit.

## HTTP production notes

- Streamable HTTP defaults to loopback in development.
- Public production HTTP requires an explicit auth decision.
- Trusted proxy configuration is mandatory for `0.0.0.0`.
- Stateful HTTP is opt-in and should use an external `SessionStore`.
- Resumability is opt-in through `eventStore` and requires clients that support
  the MCP `2025-11-25` empty-SSE priming fix.

Deployment guidance and the `SessionStore` integration contract live in
[docs/http-deployment.md](../../docs/http-deployment.md).

## Fastify integration

Use the Fastify adapter subpath when an existing Fastify process should own
listening and shutdown:

```ts
import Fastify from 'fastify'
import { createMcpApp } from '@mcp-kit/core'
import { registerFastifyStreamableHttp } from '@mcp-kit/node/fastify'

const fastify = Fastify()

registerFastifyStreamableHttp(
  fastify,
  () =>
    createMcpApp({
      name: 'example',
      version: '1.0.0',
      services: {}
    }),
  { mode: 'development' }
)
```

## Resumability

Pass an `eventStore` to `runStreamableHttp()` or
`registerFastifyStreamableHttp()` to enable `Last-Event-ID` replay support.
`createInMemoryEventStore()` is suitable for tests and development; production
deployments should keep replayable events in external storage.
