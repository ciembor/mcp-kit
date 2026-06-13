# Security Guide

`mcp-kit` treats security as part of the runtime contract, not an optional
afterthought.

## Core principles

- keep business logic transport-independent
- keep deployment-sensitive validation in the outer runtime
- prefer stateless production defaults
- require explicit opt-in for risky behavior

## HTTP deployment defaults

For `@mcp-kit/node` Streamable HTTP:

- development binds to `127.0.0.1`
- public production bind requires explicit deployment mode
- public production bind requires an explicit auth decision
- trusted proxy handling is opt-in, not inferred

See [http-deployment.md](./http-deployment.md) for the deployment shape.

## Session and scaling policy

- stateless mode is the default production path
- stateful mode is explicit and should use an external `SessionStore`
- every request must be authorized independently of session reuse
- sticky sessions must not be a correctness requirement

## Tool and capability policy

Application code should use policy and context contracts instead of raw
transport assumptions:

- `ToolPolicy` for effects, scopes, rate limits, timeouts, and concurrency
- `RequestContext.auth` for subject and tenant-aware decisions
- `RequestContext.client.*` helpers for capability-aware client interactions

## Client-side capability safety

Capability helpers in `RequestContext.client` intentionally reject unsupported
flows with stable errors instead of leaking raw SDK exceptions:

- `client.roots`
- `client.sampling`
- `client.elicitation`

Form elicitation additionally blocks secret-like fields such as passwords,
tokens, private keys, and similar credentials. Sensitive collection should use
URL elicitation or another explicit secure flow.

## Release-time expectations

Before publishing or deploying:

```sh
corepack pnpm quality:fast
corepack pnpm quality:full
```

For package release preparation:

```sh
npx mcp-kit release
```

## Security boundaries that remain caller-owned

`mcp-kit` does not replace:

- your OAuth or authorization server
- downstream secret storage
- tenant policy specific to your domain
- audit retention and compliance requirements

Those details must stay in outer adapters and application-owned ports.

## External authorization server integration

`@mcp-kit/node` can validate OAuth access tokens as a protected resource without
embedding authorization-server policy into your MCP app. Keep your auth server
outside, and wire token verification into `auth.verifyBearerToken`:

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

The verifier checks signature, `iss`, `aud`, and `exp`, and will reject tokens
that are not yet active via `nbf`. Scope mapping stays explicit through JWT
claims such as `scope` or `scp`, while consent, downstream token exchange, and
step-up rules remain caller-owned outer-layer concerns.
