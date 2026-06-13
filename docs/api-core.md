# Core API

`@mcp-kit/core` is the part of `mcp-kit` that your application code should know best. It defines the app, capabilities, request context, policy fields, and long-running jobs without choosing stdio, HTTP, Fastify, Redis, or any other deployment detail.

For the full export list, use [`@mcp-kit/core` reference](./reference/core.md).

## App

```ts
import { createMcpApp } from '@mcp-kit/core'

export const app = createMcpApp({
  name: 'example',
  version: '1.0.0',
  services
})
```

`services` is the dependency container passed to handlers through `context.services`. Keep database clients, downstream APIs, and application ports there instead of importing them directly inside MCP definitions.

## Capabilities

```ts
import { defineRegistry, defineTool } from '@mcp-kit/core'
import { z } from 'zod'

const pingTool = defineTool({
  name: 'ping',
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  handler: async () => ({
    structuredContent: { ok: true },
    content: [{ type: 'text', text: 'ok' }]
  })
})

export const tools = defineRegistry([pingTool])
```

Use `defineTool()`, `defineResource()`, and `definePrompt()` close to the feature that owns the behavior. Register them once at the app boundary.

## Request Context

Handlers receive `context`. The most common fields are `services`, `auth`, `logger`, `signal`, `progress`, `client`, and `io`.

Use `context.client` for optional MCP client capabilities such as roots, sampling, and elicitation. Use `context.io` for guarded filesystem, outbound HTTP, pagination, and destructive-operation checks.

## Policy

Policies describe what the runtime can enforce before or around handler execution: scopes, consent, input checks, file roots, outbound hosts, output limits, destructive confirmations, timeouts, rate limits, concurrency, and audit.

Domain rules still belong in the feature. A `ToolPolicy` can reject a missing scope; it should not replace your application's own permission model.

## Long-Running Jobs

`createAsyncJobOperation()` gives tools a start/status/result/cancel shape for work that should continue outside a single request.

It needs a `JobStore` for persisted state and worker leases, plus a `JobQueue` for waking workers. That keeps job state outside the Node process and lets another worker finish or return a result after a restart.
