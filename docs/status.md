# Project Status

mcp-kit is still in initial development. Do not treat the API as stable yet.

Use this page to separate what exists from what is planned.

## Implemented

The repository currently includes:

- `@mcp-kit/core` for app assembly, tools, resources, prompts, policy checks, request context, guarded tool I/O, observability hooks, and async job workflows.
- `@mcp-kit/node` for stdio, Streamable HTTP, Fastify mounting, bearer-token auth helpers, session storage ports, event replay ports, proxy handling, and HTTP safety defaults.
- `@mcp-kit/testing` for contract-level tests against MCP clients.
- `@mcp-kit/cli` and `create-mcp-kit` for project generation, adding capabilities, `doctor`, quality checks, and release checks.

## Covered By Tests

Core behavior has unit coverage for definitions, runtime policy, guarded I/O, async jobs, app registration, and protocol handlers.

Node runtime coverage includes Streamable HTTP, Fastify, sessions, event replay, proxy resolution, bearer-token verification, CORS, Host checks, request limits, and error mapping.

The repository also has architecture checks, type checks, linting, formatting, coverage thresholds, and optional mutation testing.

## Not Stable Yet

The public package shape is still `0.0.x`. Names, option shapes, middleware phases, policy stores, and generated project layout can still change before the first stable release.

Production-oriented APIs exist, but they need more real deployments before they should be considered boring. In particular, bring your own persistent stores for sessions, event replay, async jobs, rate limits, and concurrency when running more than one process.

## Experimental Or Incomplete

Native MCP Tasks integration is intentionally behind an adapter shape until the upstream API is stable.

Observability has a first-class tool execution hook. It is intentionally backend-neutral; applications still provide the OpenTelemetry, Prometheus, or custom adapter.

Idempotency helpers for write tools are not implemented yet.

## Where To Track Plans

Use `BACKLOG.md` for plans and implementation notes. Use this page when you need the current user-facing status.
