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
