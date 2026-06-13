# Package Notes

Use the existing packages before creating another one.

| Package                 | Boundary                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `@mcp-kit/core`         | Application-facing MCP definitions, policy contracts, request context, and async jobs. |
| `@mcp-kit/node`         | Node stdio and HTTP runtime behavior.                                                  |
| `@mcp-kit/node/fastify` | Fastify mounting for the Node HTTP runtime.                                            |
| `@mcp-kit/cli`          | Project generation, project checks, quality, and release commands.                     |
| `@mcp-kit/testing`      | Test clients and contract assertions.                                                  |

Do not add a package only to move code into a new name. A new package should hide a real difference in runtime, ownership, dependency weight, or public API.

The project does not currently ship separate `@mcp-kit/security`, `@mcp-kit/quality`, or `@mcp-kit/architecture` packages. Security behavior is part of the Node runtime, and quality and architecture checks are part of the CLI because they are tied to the generated project shape.
