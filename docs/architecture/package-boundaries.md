# Package Boundary Evaluation

## `@mcp-kit/security`

Decision: do not extract `@mcp-kit/security` yet.

Reasoning:

- Current security policy is inseparable from the Node HTTP adapter:
  trusted proxies, host/origin validation, session behavior, auth decisions,
  and audit flow depend on transport and deployment context.
- Extracting now would move names, not knowledge. Callers would still need to
  understand Node transport semantics, which means the new package would be
  shallow.

Revisit when:

- security policy is reused by more than one outer adapter
- ports are stable enough that transport packages consume them instead of
  re-defining them

## `@mcp-kit/quality`

Decision: do not extract `@mcp-kit/quality` yet.

Reasoning:

- Quality rules are intentionally coupled to the official generator output and
  the single feature-first architecture. They are product policy, not a generic
  standalone library.
- A package split would force version choreography across CLI, templates, and
  tests without giving users a simpler API.

Revisit when:

- quality rules are consumed independently of the CLI
- templates and quality policy need different release cadence

## `@mcp-kit/architecture`

Decision: do not extract `@mcp-kit/architecture` yet.

Reasoning:

- Architecture analysis is one of the CLI's main use cases. Its current value
  comes from being wired directly into generation, doctor, and quality flows.
- Splitting now would expose unstable intermediate analysis shapes and create a
  second public boundary before the rules have settled.

Revisit when:

- architecture checks need to be embedded by third-party tooling
- rule data structures and diagnostics are stable enough to document as public
  contracts

## Summary

Keep the current package boundaries:

- `@mcp-kit/core` for transport-independent MCP behavior
- `@mcp-kit/node` for production HTTP and stdio runtime details
- `@mcp-kit/cli` for generation, architecture analysis, and quality policy
- `@mcp-kit/testing` for test harnesses and contract assertions

No extraction is justified until it hides more complexity than it adds.
