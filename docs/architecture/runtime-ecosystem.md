# Runtime Ecosystem Evaluation

## Web Standard adapter for Deno, Bun, and edge runtimes

Decision: defer a dedicated Web Standard adapter until one inner runtime
contract emerges that is meaningfully deeper than the current Node wrapper.

Reasoning:

- `@mcp-kit/core` is already transport-independent, so a second outer adapter
  should hide runtime-specific request streaming, shutdown, auth, and deployment
  details rather than re-export the SDK with renamed functions.
- Deno, Bun, and edge platforms differ in enough operational details
  (`ReadableStream` behavior, long-lived connections, crypto/session storage,
  signal handling, deployment limits) that a shallow "web adapter" today would
  leak those differences back to callers.
- The official SDK already owns the base Web Standard transport surface. A new
  package only makes sense once `mcp-kit` can add stable value above that level:
  safe defaults, deployment policy, shared auth/session ports, and consistent
  lifecycle hooks.

Acceptance criteria for revisiting:

- at least two non-Node runtimes need the same higher-level contract
- the contract can stay smaller than the implementation details it hides
- tests can run the same feature matrix without runtime-specific application
  code

Current direction:

- keep `@mcp-kit/core` portable
- keep `@mcp-kit/node` as the only production adapter
- revisit a `@mcp-kit/web` package when Bun or Deno support would otherwise
  duplicate HTTP policy, session, and gateway logic

## Express and Hono integration

Decision: do not ship first-party Express or Hono integrations yet.

Reasoning:

- Both frameworks would currently be thin wrappers around the same Streamable
  HTTP handler. Thin wrappers add names and release surface, but they do not
  hide meaningful complexity.
- A framework integration should own real translation work: request/response
  bridging, trusted proxy handling, auth hooks, shutdown wiring, and testable
  escape hatches. Today that logic already lives in the framework-neutral Node
  layer.
- Shipping separate Express and Hono adapters now would create maintenance cost
  without reducing caller knowledge. Users would still need to understand the
  same MCP, proxy, auth, and session constraints.

Criteria for first-party integration:

- the framework has lifecycle or middleware constraints that the neutral Node
  API cannot express cleanly
- the integration removes repeated boilerplate from multiple users
- the adapter can be tested as a deep module rather than a pass-through helper

Current recommendation:

- use `runStreamableHttp()` for standalone deployments
- integrate other frameworks by delegating to the existing Streamable HTTP
  handler boundary rather than adding public framework-specific packages yet
