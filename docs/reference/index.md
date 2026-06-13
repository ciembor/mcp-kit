# Reference

This section documents the public surface of every published package in the
workspace, including root exports and explicitly published subpaths.

## Packages

- [`@mcp-kit/core`](./core)
- [`@mcp-kit/node`](./node)
- [`@mcp-kit/node/fastify`](./node-fastify)
- [`@mcp-kit/cli`](./cli)
- [`@mcp-kit/testing`](./testing)
- [`create-mcp-kit`](./create-mcp-kit)

## Reading Rules

- Only root exports count as public API.
- Deep imports into `src/**` are internal unless the package publishes a
  documented subpath such as `@mcp-kit/node/fastify`.
- Runtime behavior described here is semver-governed together with the exports.
