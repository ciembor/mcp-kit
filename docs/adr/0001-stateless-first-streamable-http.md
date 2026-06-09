# ADR 0001: Stateless-first Streamable HTTP

- Status: accepted
- Date: 2026-06-09

## Context

Production MCP servers need horizontal scaling, predictable recovery, and no
dependency on sticky sessions or process-local state.

## Decision

Remote production servers use Streamable HTTP and are stateless by default.
STDIO remains the local development transport. Stateful mode is explicit and
stores session and job state behind external ports. Process memory is never
the production source of truth.

## Consequences

- Workers can be replaced or scaled independently.
- Multi-worker tests must route related requests to different workers.
- Redis, PostgreSQL, and queue products are adapters, not core dependencies.
- `Mcp-Session-Id` is correlation state, never authentication.
