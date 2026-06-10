# @mcp-kit/node

Node.js transport and process lifecycle integration for mcp-kit.

## HTTP production notes

- Streamable HTTP defaults to loopback in development.
- Public production HTTP requires an explicit auth decision.
- Trusted proxy configuration is mandatory for `0.0.0.0`.
- Stateful HTTP is opt-in and should use an external `SessionStore`.

Deployment guidance and the `SessionStore` integration contract live in
[docs/http-deployment.md](../../docs/http-deployment.md).
