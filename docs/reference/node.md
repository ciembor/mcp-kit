# `@mcp-kit/node`

`@mcp-kit/node` runs an `@mcp-kit/core` app on Node.js. It supports stdio, Streamable HTTP, Fastify mounting, OAuth resource-server helpers, stateful sessions, and event replay.

## Entrypoints

| Export                                               | Use                                                       |
| ---------------------------------------------------- | --------------------------------------------------------- |
| `runStdio(app)`                                      | Connect an app to the MCP stdio transport.                |
| `runStreamableHttp(createApp, options?)`             | Start a Streamable HTTP server.                           |
| `createJwtBearerVerifier(options)`                   | Build a bearer-token verifier for HTTP auth.              |
| `exchangeDownstreamAccessToken(port, auth, request)` | Exchange the current auth context for a downstream token. |
| `createInMemoryEventStore()`                         | Event replay store for tests and local development.       |
| `createInMemorySessionStore()`                       | Session store for tests and local development.            |
| `createStderrLogger()`                               | Default process-safe logger.                              |
| `packageInfo`                                        | Published package name and version.                       |

## Stdio

```ts
import { runStdio } from '@mcp-kit/node'
import { app } from './app.js'

const runtime = await runStdio(app)
```

`runStdio()` installs signal-aware shutdown handling and returns `StdioRuntime` with `close()`.

## Streamable HTTP

```ts
import { runStreamableHttp } from '@mcp-kit/node'
import { createApp } from './app.js'

const runtime = await runStreamableHttp(createApp, {
  mode: 'production',
  host: '0.0.0.0',
  path: '/mcp',
  auth: { verifyBearerToken }
})
```

`runStreamableHttp()` returns `StreamableHttpRuntime` with:

| Field     | Use                                               |
| --------- | ------------------------------------------------- |
| `url`     | Bound runtime URL.                                |
| `options` | Normalized runtime options.                       |
| `drain()` | Stop accepting new work and wait for active work. |
| `close()` | Drain and close the runtime.                      |

Pass an app factory as `createApp`. The HTTP runtime decides when it needs a fresh app instance.

## HTTP Options

| Option                                               | Use                                                        |
| ---------------------------------------------------- | ---------------------------------------------------------- |
| `mode`                                               | `development` or `production`.                             |
| `host`, `port`, `path`                               | Bind address and MCP path.                                 |
| `healthPath`, `readinessPath`                        | Probe paths.                                               |
| `sessionMode`, `sessionStore`                        | Stateful session support.                                  |
| `eventStore`, `retryIntervalMs`                      | Stream replay and reconnect hints.                         |
| `auth`                                               | Bearer-token verification and protected resource metadata. |
| `trustedProxies`                                     | Proxy addresses allowed to set forwarded headers.          |
| `allowedHosts`, `allowedOrigins`, `cors`             | Host and browser-origin restrictions.                      |
| `maxBodyBytes`, `requestTimeoutMs`, `maxConcurrency` | Request limits.                                            |

Use external `SessionStore` and `StreamableHttpEventStore` implementations in production when state must survive a restart.

## Auth

`StreamableHttpAuthOptions` accepts `verifyBearerToken(token, request)`, optional `allowAnonymous`, optional `challenge`, and optional protected-resource `metadata`.

`verifyBearerToken()` must return an `AuthContext`. The runtime checks the HTTP boundary; your verifier maps tokens to subjects, tenants, scopes, and consent.

## JWT Verifier

```ts
import { createJwtBearerVerifier } from '@mcp-kit/node'

const verifyBearerToken = createJwtBearerVerifier({
  issuer: 'https://auth.example',
  audience: 'https://mcp.example/mcp',
  discoveryUrl: 'https://auth.example/.well-known/openid-configuration'
})
```

Supported options include `issuer`, `audience`, `jwksUri`, `discoveryUrl`, `algorithms`, `clockSkewSeconds`, `subjectClaim`, `clientIdClaim`, `tenantIdClaim`, `scopesClaim`, `availableScopesClaim`, `resource`, `jwksCacheTtlMs`, and `consent`.

The verifier checks RSA JWT signatures through JWKS, issuer, audience, expiry, `nbf`, and configured scope claims.

## Downstream Token Exchange

`exchangeDownstreamAccessToken(port, auth, request)` fills `clientId`, `subject`, and `resource` from the current auth context when the request does not provide them.

Related types are `OAuthConsentPort`, `OAuthConsentRecord`, `OAuthTokenExchangePort`, `OAuthTokenExchangeRequest`, and `OAuthTokenExchangeResult`.

Use this helper when a tool needs a downstream credential. It avoids passing the caller's bearer token through your app by accident.

## Fastify

The package publishes [`@mcp-kit/node/fastify`](./node-fastify.md) for mounting the same HTTP runtime inside an existing Fastify process.

Deployment guidance lives in [HTTP Deployment](../http-deployment.md). Auth and policy guidance lives in [Security](../security-guide.md).
