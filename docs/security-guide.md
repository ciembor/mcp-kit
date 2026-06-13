# Security

This page covers the security decisions you make when an MCP server stops being a local prototype.

## HTTP Defaults

Development servers bind to `127.0.0.1`. A public bind such as `0.0.0.0` requires `mode: 'production'` and an explicit auth configuration.

For production HTTP, start with:

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

`trustedProxies` should name only infrastructure you control. Do not accept forwarded host or protocol headers from direct clients.

`allowedHosts` entries match exactly. `mcp.example.com` does not accept `mcp.example.com:8443`; write the port explicitly, or use `mcp.example.com:*` if any port is intentional.

## Bearer Tokens

`@mcp-kit/node` can validate JWT access tokens for a protected MCP resource.

```ts
import { createJwtBearerVerifier, runStreamableHttp } from '@mcp-kit/node'

const verifyBearerToken = createJwtBearerVerifier({
  issuer: 'https://auth.example',
  audience: 'https://mcp.example/mcp',
  discoveryUrl: 'https://auth.example/.well-known/openid-configuration',
  resource: 'https://mcp.example/mcp'
})

await runStreamableHttp(createApp, {
  mode: 'production',
  auth: {
    verifyBearerToken,
    metadata: {
      authorizationServers: ['https://auth.example'],
      resourceName: 'Example MCP server',
      scopesSupported: ['tools:read', 'tools:write']
    }
  }
})
```

The verifier checks signature, issuer, audience, expiry, and `nbf`. It can read scopes from `scope`, `scp`, or a configured claim. It returns an auth context for handlers; it does not pass the raw bearer token into application code.

## Capability Policy

Put MCP-facing policy on the capability definition. Keep domain permission rules in your application code.

```ts
export const deleteUserTool = defineTool({
  name: 'delete-user',
  inputSchema,
  outputSchema,
  policy: {
    effects: 'write',
    requiredScopes: ['users.write'],
    destructive: {
      requireConfirmation: true
    }
  },
  handler
})
```

Use `requiredScopes` for normal scope checks. Use `stepUpScopes` when a tool should fail with a step-up style denial. Use `requiredConsentScopes` when the verifier is configured with a consent store.

## Files And Outbound HTTP

Tools that touch files or make network calls should use `context.io`, not raw filesystem or fetch calls. That gives the runtime one place to enforce roots, host allowlists, private-network blocking, and result-size limits.

```ts
const path = await context.io.files.resolvePath(input.path)
context.io.http.assertAllowed(input.url)
```

If a tool uses outbound HTTP policy, give it an `outputSchema`. The result should be shaped before it crosses the MCP boundary.

## Client Capabilities

`RequestContext.client` wraps optional MCP client capabilities:

| Helper               | Use                                                   |
| -------------------- | ----------------------------------------------------- |
| `client.roots`       | Read client-provided roots.                           |
| `client.sampling`    | Ask the client model to create a message.             |
| `client.elicitation` | Ask the user for additional input through the client. |

Unsupported flows fail with `McpKitError`, so handlers can handle a known error shape. Form elicitation blocks secret-like fields such as passwords, tokens, and private keys. Use a secure URL flow for credential collection.

## Downstream Services

Do not forward the caller's bearer token to downstream systems by default. If a tool needs a downstream token, keep the exchange code in an outer adapter and call it through a port.

```ts
import { exchangeDownstreamAccessToken } from '@mcp-kit/node'

const downstream = await exchangeDownstreamAccessToken(
  tokenExchangePort,
  context.auth ?? {},
  { scopes: ['calendar:write'] }
)
```

Your application still owns tenant policy, audit retention, secret storage, and authorization-server configuration. `mcp-kit` gives you the runtime hooks; it does not replace those systems.
