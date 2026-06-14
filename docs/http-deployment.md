# HTTP Deployment

`@mcp-kit/node` can run a server over Streamable HTTP. The default production setup should be stateless, sit behind a trusted gateway, and authenticate every request.

## Basic Server

```ts
import { runStreamableHttp } from '@mcp-kit/node'
import { createApp } from './app.js'

await runStreamableHttp(createApp, {
  mode: 'production',
  host: '0.0.0.0',
  port: 3000,
  path: '/mcp',
  auth: {
    verifyBearerToken
  }
})
```

Pass a factory to `runStreamableHttp()`, not an already connected app. The HTTP runtime creates app instances when it needs isolated request or session state.

## Reverse Proxy

Put the public endpoint behind your gateway or reverse proxy. Configure the runtime with the exact proxy addresses that are allowed to send forwarding headers.

```ts
await runStreamableHttp(createApp, {
  mode: 'production',
  host: '0.0.0.0',
  trustedProxies: ['10.0.0.10'],
  allowedHosts: ['mcp.example.com'],
  allowedOrigins: ['https://app.example.com'],
  auth: { verifyBearerToken }
})
```

Only trusted proxies can affect the public URL through `Forwarded` or `X-Forwarded-*`. Requests from normal clients get their host and protocol from the direct request, not from spoofed headers.

`allowedHosts` matches exactly. Use `mcp.example.com:443` when the public port matters, or `mcp.example.com:*` only when you intentionally accept that host on any port.

Use `/healthz` for liveness probes and `/readyz` for readiness probes unless you override those paths.

## Fastify

If your process already owns a Fastify server, mount MCP routes instead of starting another HTTP server.

```ts
import { registerFastifyStreamableHttp } from '@mcp-kit/node/fastify'

await registerFastifyStreamableHttp(fastify, createApp, {
  mode: 'production',
  path: '/mcp',
  auth: { verifyBearerToken }
})
```

Fastify still owns `listen()` and process shutdown. During rolling shutdown, call the returned `drain()` before closing the Fastify server.

## Sessions

Stateless mode is the production default. Use stateful sessions only when the client flow needs them.

When `sessionMode` is `stateful`, production deployments need a `SessionStore` outside the Node process:

```ts
import type { SessionStore } from '@mcp-kit/node'

export const sessionStore: SessionStore = {
  get: (sessionId) => redisLoadSession(sessionId),
  set: (sessionId, session) => redisSaveSession(sessionId, session),
  delete: (sessionId) => redisDeleteSession(sessionId),
  list: () => redisListSessions()
}
```

Do not rely on sticky sessions for correctness. Any worker that receives the next request must be able to load the session, verify the current user, and continue safely.

The current `SessionStore` contract still stores live `ManagedSession` handles, so it is production-safe only inside one process. See [Store Guarantees](./reference/store-guarantees.md) for the exact limitation and the guarantees expected from the other production stores.

## Resumability

Use an `eventStore` when clients must reconnect and replay missed Streamable HTTP events.

```ts
await runStreamableHttp(createApp, {
  mode: 'production',
  eventStore,
  retryIntervalMs: 1000,
  auth: { verifyBearerToken }
})
```

`createInMemoryEventStore()` is useful for tests and local development. In production, store replayable events outside the process or reconnects after a restart will not have anything to replay.

See [Store Guarantees](./reference/store-guarantees.md) for the required replay ordering, retention, and indexing behavior.

Browsers that reconnect with `Last-Event-ID` need CORS configured so that header is allowed.

## Production Checklist

| Setting      | Recommendation                                                            |
| ------------ | ------------------------------------------------------------------------- |
| TLS          | Terminate at the gateway or a trusted internal proxy.                     |
| Bind address | Use `0.0.0.0` only with `mode: 'production'` and an explicit auth choice. |
| Auth         | Verify every request. Session reuse is not authorization.                 |
| Proxies      | Set `trustedProxies` to exact proxy IPs or CIDRs.                         |
| Sessions     | Keep state outside process memory if using `stateful` mode.               |
| Shutdown     | Call `drain()`, then close the server.                                    |
