# ADR 0002: Stateful Session Rehydration Spike

We ran a spike to decide whether `SessionStore` can become a real cross-instance production port with the current MCP SDK transport.

Result: not with the current transport contract.

The blocker is structural, not accidental:

- `SessionStore` stores a live `ManagedSession` object with `handleRequest()` and `close()`, not serializable session state.
- `createStatefulSession()` creates a `WebStandardStreamableHTTPServerTransport` instance and keeps it inside the stored session.
- The SDK transport keeps session state in memory, including the active `sessionId` and internal stream/request mappings.
- The SDK exposes `sessionIdGenerator`, `onsessioninitialized`, `onsessionclosed`, and `eventStore`, but it does not expose a serialization or rehydration hook for the transport state.
- Recreating a fresh transport in another process would create a different in-memory transport instance, not a continuation of the original session.

Relevant code paths:

- [`ManagedSession` stores live handlers](../../packages/node/src/http-store-contracts.ts)
- [`createStatefulSession()` persists a live transport instance](../../packages/node/src/http-handler-stateful.ts)
- [`WebStandardStreamableHTTPServerTransport` is stateful in memory](../../node_modules/.pnpm/@modelcontextprotocol+sdk@1.29.0_zod@4.4.3/node_modules/@modelcontextprotocol/sdk/dist/esm/server/webStandardStreamableHttp.d.ts)

Decision:

- Keep `sessionMode: 'stateful'` as a single-process feature.
- Do not ship a Redis `SessionStore` adapter that would imply cross-instance continuity.
- Keep production HTTP stateless-first.
- Revisit only if the upstream SDK exposes serializable transport state or a supported rehydration API.
