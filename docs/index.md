---
layout: home

hero:
  name: 'mcp-kit'
  text: 'Framework and tooling for reliable MCP servers'
  tagline: 'Transport-independent app assembly, production HTTP runtime, generator, quality gates, and test harnesses in one workspace.'
  actions:
    - theme: brand
      text: Start With The Tutorial
      link: /tutorial
    - theme: alt
      text: Read The API Reference
      link: /reference/

features:
  - title: One architecture
    details: Generated projects use one official feature-first shape with explicit registry wiring and stable package boundaries.
  - title: Production-first runtime
    details: Streamable HTTP defaults, proxy rules, resumability, OAuth resource-server support, and stateful session escape hatches live in the Node layer.
  - title: Strong quality gates
    details: Coverage, lint, architecture checks, smoke tests, release checks, and optional mutation testing are part of the product contract.
  - title: Real testing surface
    details: In-memory and stdio test clients plus contract assertions let you verify tools, prompts, resources, and transports without inventing your own harness.
---

## What This Site Covers

This VitePress site is the canonical documentation for the whole workspace:

- tutorials for creating and extending a server
- operational guides for HTTP, security, release, and mutation testing
- architecture notes and ADRs
- reference pages for every public package export and the main runtime methods

## Package Map

- `@mcp-kit/core`: transport-independent app assembly, definitions, policy contracts, and runtime helpers
- `@mcp-kit/node`: stdio and Streamable HTTP runtime, OAuth resource-server support, session and resumability adapters
- `@mcp-kit/cli`: generation, doctor, quality, release, and project analysis commands
- `@mcp-kit/testing`: test clients and contract assertions
- `create-mcp-kit`: programmatic and `npm create` entrypoint for scaffolding projects

## Suggested Reading Order

1. [Tutorial](/tutorial)
2. [HTTP Deployment](/http-deployment)
3. [Security Guide](/security-guide)
4. [Reference Home](/reference/)
5. [Architecture Notes](/architecture/runtime-ecosystem)
