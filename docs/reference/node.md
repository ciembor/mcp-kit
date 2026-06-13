# `@mcp-kit/node`

Node.js runtime package for stdio, Streamable HTTP, resumability, and OAuth
resource-server behavior.

## Package Exports

- `runStdio()`
- `runStreamableHttp()`
- `createJwtBearerVerifier()`
- `exchangeDownstreamAccessToken()`
- `createInMemoryEventStore()`
- `createInMemorySessionStore()`
- `createStderrLogger()`
- `packageInfo`

## Server Entrypoints

### `runStdio(app)`

Connects an `McpApp` to the MCP stdio transport and installs signal-aware
shutdown handling.

Returns `StdioRuntime`:

- `close()`: close the app and remove process signal handlers

### `runStreamableHttp(createApp, options?)`

Creates and starts a production-oriented HTTP runtime around
`WebStandardStreamableHTTPServerTransport`.

Returns `StreamableHttpRuntime`:

- `url`: bound runtime URL
- `options`: normalized runtime options
- `drain()`: stop admitting new work and drain active sessions
- `close()`: drain and fully close the runtime

`createApp` is a factory, not an app instance. The HTTP layer owns app
construction so it can create isolated sessions and runtime state when needed.

## HTTP Runtime Types

### `StreamableHttpOptions`

Main fields:

- `mode?`: `development` or `production`
- `host?`, `port?`, `path?`
- `healthPath?`, `readinessPath?`
- `sessionMode?`: `stateless` or `stateful`
- `sessionStore?`
- `eventStore?`
- `retryIntervalMs?`
- `auth?`
- `trustedProxies?`
- `allowedHosts?`
- `allowedOrigins?`
- `cors?`
- `maxBodyBytes?`
- `requestTimeoutMs?`
- `maxConcurrency?`

### `StreamableHttpAuthOptions`

Auth integration boundary:

- `verifyBearerToken(token, request)`: caller-owned token verification
- `allowAnonymous?`
- `challenge?`
- `metadata?`: protected resource metadata fields exposed through
  `/.well-known/oauth-protected-resource/*`

`verifyBearerToken()` must return an `AuthContext`. The runtime validates the
HTTP boundary, but your verifier owns identity mapping and token policy.

### Stateful and resumability contracts

- `SessionStore`
- `ManagedSession`
- `StreamableHttpEventStore`
- `McpAppFactory`

Use external implementations for production if sessions or replay must survive
process restarts.

## Built-In OAuth Helpers

### `createJwtBearerVerifier(options)`

Creates a `verifyBearerToken` callback compatible with `StreamableHttpAuthOptions`.

Supported behavior:

- RSA JWT signature validation via JWKS
- issuer, audience, expiry, and `nbf` checks
- OIDC discovery or explicit `jwksUri`
- scope extraction from `scope` / `scp` or caller-specified claims
- optional consent loading through a caller-owned port
- available-scope and consent projection into `AuthContext.authorization`

Main option fields:

- `issuer`
- `audience`
- `jwksUri?`
- `discoveryUrl?`
- `algorithms?`
- `clockSkewSeconds?`
- `subjectClaim?`
- `clientIdClaim?`
- `tenantIdClaim?`
- `scopesClaim?`
- `availableScopesClaim?`
- `resource?`
- `jwksCacheTtlMs?`
- `consent?`

### `exchangeDownstreamAccessToken(port, auth, request)`

Token-exchange helper that fills `clientId`, `subject`, and `resource` from
the current auth context when the caller does not provide them explicitly.

Related types:

- `OAuthConsentPort`
- `OAuthConsentRecord`
- `OAuthTokenExchangePort`
- `OAuthTokenExchangeRequest`
- `OAuthTokenExchangeResult`

Use this helper instead of forwarding the caller token downstream. That keeps
resource-server boundaries explicit and prevents token passthrough by default.

## Utility Exports

- `createInMemoryEventStore()`: in-memory event replay store for tests and
  development
- `createInMemorySessionStore()`: in-memory session store for tests and
  development
- `createStderrLogger()`: default process-safe logger used by Node runtimes

## Published Subpath

The package also publishes [`@mcp-kit/node/fastify`](./node-fastify) for
mounting the MCP runtime inside an existing Fastify process.

See also:

- [HTTP deployment guide](../http-deployment)
- [Security guide](../security-guide)
