# Streamable HTTP Deployment

`@mcp-kit/node` is designed for stateless-first production deployments.

## Reverse proxy

Expose the MCP endpoint behind a reverse proxy or API gateway and configure:

- `host: '0.0.0.0'`
- `mode: 'production'`
- `trustedProxies: ['10.0.0.10']` or the exact proxy IPs
- `auth` explicitly, even when anonymous access is an intentional choice

Only trusted proxies may influence canonical request URLs through `Forwarded` or
`X-Forwarded-*`. Untrusted clients cannot spoof public host or protocol.

The runtime derives:

- canonical MCP resource URL from the trusted forwarded host/proto
- protected resource metadata from the same canonical URL
- health/readiness responses without trusting arbitrary client headers

## SessionStore contract

Stateful HTTP is an explicit opt-in and requires a `SessionStore` outside
development. The production contract is:

```ts
import type { ManagedSession, SessionStore } from '@mcp-kit/node'

export const sessionStore: SessionStore = {
  get(sessionId) {
    return redisLoadSession(sessionId)
  },
  set(sessionId, session) {
    return redisSaveSession(sessionId, session)
  },
  delete(sessionId) {
    return redisDeleteSession(sessionId)
  },
  list() {
    return redisListSessions()
  }
}
```

Requirements:

- `get()` must return the current managed session for a request worker
- `set()` must persist the session as soon as initialization succeeds
- `delete()` must remove the binding before closing session resources
- `list()` must return every active session so graceful shutdown can drain them

For multi-replica deployments:

- keep session state out of local process memory
- authenticate every request independently
- bind session reuse to the same `subject` and `tenant`
- avoid sticky sessions as a correctness requirement

## Recommended production shape

1. TLS terminates at the gateway or a trusted internal proxy.
2. Gateway forwards only standard proxy headers.
3. MCP workers run with stateless mode by default.
4. Stateful mode uses an external `SessionStore`.
5. Health probes target `/healthz`; readiness probes target `/readyz`.
6. Rolling shutdown calls `drain()` first, then closes the server.
