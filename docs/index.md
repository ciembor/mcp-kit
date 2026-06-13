---
layout: home

hero:
  name: 'mcp-kit'
  text: 'Build MCP servers in TypeScript'
  tagline: 'Scaffold a server, define tools and resources, run it over stdio or Streamable HTTP, and test the public MCP behavior.'
  actions:
    - theme: brand
      text: Start the tutorial
      link: /tutorial
    - theme: alt
      text: Open the reference
      link: /reference/

features:
  - title: Project template
    details: '`create-mcp-kit` creates a small server with a health feature, tests, and local quality commands.'
  - title: Core app API
    details: '`@mcp-kit/core` defines tools, resources, prompts, policies, request context, and long-running jobs without choosing a transport.'
  - title: Node runtime
    details: '`@mcp-kit/node` runs the app over stdio or Streamable HTTP, with production options for auth, proxies, sessions, and resumability.'
  - title: Test helpers
    details: '`@mcp-kit/testing` gives you in-memory and stdio clients so tests exercise the MCP contract instead of private functions.'
---

## Start Here

If you are new to the project, read the [status page](/status) first, then follow the [tutorial](/tutorial). The tutorial creates a server, shows where generated code lives, adds a tool, runs tests, and points to the deployment settings you need before exposing HTTP.

Use [HTTP Deployment](/http-deployment) when the server will run behind a gateway or reverse proxy. Use [Security](/security-guide) before adding auth, tenant checks, file access, downstream HTTP, or destructive tools.

The [Reference](/reference/) pages are for exact package exports and runtime options.

## Packages

| Package                 | Use it for                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `@mcp-kit/core`         | App assembly, capability definitions, request context, policies, and async jobs.   |
| `@mcp-kit/node`         | Stdio, Streamable HTTP, OAuth resource-server helpers, sessions, and event replay. |
| `@mcp-kit/node/fastify` | Mounting the HTTP runtime in an existing Fastify server.                           |
| `@mcp-kit/cli`          | Project generation, `doctor`, quality checks, and release checks.                  |
| `@mcp-kit/testing`      | Contract assertions and MCP test clients.                                          |
| `create-mcp-kit`        | The `npm create mcp-kit` entrypoint.                                               |
