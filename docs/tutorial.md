# Tutorial

This tutorial walks through the supported `mcp-kit` workflow from scaffold to
runtime to quality gate.

## 1. Create a server

```sh
corepack pnpm create mcp-kit my-server
cd my-server
```

For a non-interactive run:

```sh
corepack pnpm create mcp-kit my-server -- --yes --no-install
```

## 2. Inspect the generated shape

The generated project uses one official feature-first architecture:

- `src/features/<feature>/application`
- `src/features/<feature>/mcp`
- optional `domain`, `application/ports`, and `infrastructure` only when the
  feature needs them
- `src/mcp/registry.ts` as the explicit capability registry

The minimal generated server already includes a health feature, integration
tests, and project-local quality scripts.

## 3. Read the starter app

The composition root lives in `src/app.ts` and wires the server through
`createMcpApp()`. The feature capability registry is explicit:

```ts
import { defineRegistry } from '@mcp-kit/core'
import { healthPrompt } from '../features/health/mcp/health.prompt.js'
import { healthResource } from '../features/health/mcp/health.resource.js'
import { healthTool } from '../features/health/mcp/health.tool.js'

export const tools = defineRegistry([healthTool])
export const resources = defineRegistry([healthResource])
export const prompts = defineRegistry([healthPrompt])
```

This is the main pattern across the workspace: definitions stay close to the
feature, while registration happens once at the composition root.

## 4. Run quality checks

```sh
corepack pnpm quality:fast
```

Use the generated project-local command when working inside a created server:

```sh
npm run quality:fast
```

## 5. Add a tool

```sh
npx mcp-kit add tool get-user
```

This updates:

- the feature directory for `get-user`
- the explicit registry
- generated contract tests and docs where applicable

The generated tool should then be filled with feature logic in:

- `src/features/get-user/application`
- `src/features/get-user/mcp`
- optional domain or infrastructure layers only if the use case needs them

## 6. Add behavior

The standard tool shape is:

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

Important design rule: business rules stay in the feature and the MCP handler
stays thin. If a tool starts collecting branching, persistence, or policy
knowledge, push that logic into the feature module behind the handler.

## 7. Run the server

For stdio projects:

```sh
npm run dev
```

For HTTP-enabled projects:

```sh
MCP_TRANSPORT=http npm run dev
```

## 8. Test the feature

Use the project-local test commands for regression safety:

```sh
npm test
npm run quality:fast
```

When you need black-box MCP tests, use `@mcp-kit/testing`:

```ts
import { createMcpTestClient } from '@mcp-kit/testing'
import { app } from '../src/app.js'

const testClient = await createMcpTestClient(app)
```

## 9. Validate before release

```sh
corepack pnpm quality:fast
corepack pnpm quality:full
```

Release preparation always goes through the release gate:

```sh
npx mcp-kit release
```

## What to learn next

- Read [HTTP deployment](./http-deployment.md) before exposing a server beyond
  localhost.
- Read [security guide](./security-guide.md) before adding auth, scopes, or
  tenant-aware logic.
- Use [reference pages](./reference/) when you need exact package exports and
  runtime methods.
- Review [mutation testing](./mutation-testing.md) when the basic quality gate
  is already green and you want stronger behavioral coverage.
