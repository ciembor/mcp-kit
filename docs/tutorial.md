# Tutorial

This page builds the smallest useful `mcp-kit` server and shows where to put the next piece of real application code.

## Create a server

```sh
corepack pnpm create mcp-kit my-server
cd my-server
```

For CI or scripted setup, use the non-interactive form:

```sh
corepack pnpm create mcp-kit my-server -- --yes --no-install
```

The generated project contains one health feature, stdio and HTTP entrypoints, integration tests, and local quality scripts.

## Read the generated layout

Generated code is grouped by feature. A feature starts small and grows only when it needs more structure.

| Path                                    | What belongs there                                             |
| --------------------------------------- | -------------------------------------------------------------- |
| `src/features/<feature>/mcp`            | Tool, prompt, and resource definitions.                        |
| `src/features/<feature>/application`    | Use cases called by MCP handlers.                              |
| `src/features/<feature>/domain`         | Domain rules that should not know about MCP or HTTP.           |
| `src/features/<feature>/infrastructure` | Database, network, or filesystem adapters used by the feature. |
| `src/mcp/registry.ts`                   | The one place where exported capabilities are registered.      |

The registry is explicit on purpose. When a capability is public, it should be easy to find.

```ts
import { defineRegistry } from '@mcp-kit/core'
import { healthPrompt } from '../features/health/mcp/health.prompt.js'
import { healthResource } from '../features/health/mcp/health.resource.js'
import { healthTool } from '../features/health/mcp/health.tool.js'

export const tools = defineRegistry([healthTool])
export const resources = defineRegistry([healthResource])
export const prompts = defineRegistry([healthPrompt])
```

## Run the quality check

```sh
npm run quality:fast
```

Use this command while developing. It catches type errors, broken tests, lint failures, architecture drift, and packaging mistakes that the template is designed to avoid.

## Add a tool

```sh
npx mcp-kit add tool get-user
```

The command creates the feature files and updates the registry. Put MCP input and output shape in `src/features/get-user/mcp`. Put the actual use case in `src/features/get-user/application`.

```ts
import { defineTool } from '@mcp-kit/core'
import { z } from 'zod'

export const getUserTool = defineTool({
  name: 'get-user',
  inputSchema: z.object({
    id: z.string().min(1)
  }),
  outputSchema: z.object({
    id: z.string(),
    email: z.string().email()
  }),
  policy: {
    effects: 'read',
    requiredScopes: ['users.read']
  },
  handler: async ({ input, context }) => {
    const user = await context.services.users.getById(input.id)

    return {
      structuredContent: user,
      content: [{ type: 'text', text: `Loaded ${user.email}` }]
    }
  }
})
```

Keep the handler boring. It should translate MCP input into a use-case call, then translate the result back into MCP output. Move branching, persistence, permissions, and domain rules into the feature code behind it.

## Run the server

For stdio:

```sh
npm run dev
```

For HTTP:

```sh
MCP_TRANSPORT=http npm run dev
```

Before exposing HTTP outside your machine, read [HTTP Deployment](./http-deployment.md) and [Security](./security-guide.md). The development defaults are intentionally local.

## Test behavior

Start with the generated tests:

```sh
npm test
npm run quality:fast
```

When a test should behave like an MCP client, use `@mcp-kit/testing`:

```ts
import { createMcpTestClient } from '@mcp-kit/testing'
import { app } from '../src/app.js'

const testClient = await createMcpTestClient(app)
```

Use contract tests for exported tools, prompts, and resources. Use stdio tests when process startup or protocol negotiation matters.

## Next Steps

| Need                                            | Read                                    |
| ----------------------------------------------- | --------------------------------------- |
| Deploy over HTTP                                | [HTTP Deployment](./http-deployment.md) |
| Add auth, scopes, file access, or outbound HTTP | [Security](./security-guide.md)         |
| Check package exports and runtime options       | [Reference](./reference/)               |
| Strengthen tests after normal coverage is green | [Testing](./mutation-testing.md)        |
