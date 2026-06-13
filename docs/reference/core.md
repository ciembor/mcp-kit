# `@mcp-kit/core`

Transport-independent core APIs for assembling MCP servers.

## Package Exports

- `createMcpApp()`
- `defineTool()`
- `defineResource()`
- `definePrompt()`
- `defineRegistry()`
- `completable()`
- `getCompleter()`
- `isCompletable()`
- `unwrapCompletable()`
- `McpKitError`
- `packageInfo`
- `silentLogger`
- `timeoutAbortError()`
- `trackProtocolVersion()`

## App Assembly

### `createMcpApp(options)`

Builds an MCP application without binding it to stdio or HTTP.

`McpAppOptions<Services>`:

- `name`: server name reported to MCP clients
- `version`: server version reported to MCP clients
- `services`: dependency container injected into handlers through
  `RequestContext.services`
- `logger?`: optional logger override
- `instructions?`: optional MCP server instructions
- `middleware?`: custom tool middleware appended after built-in policy,
  audit, concurrency, timeout, and rate-limit middleware

## Main Runtime Object

### `McpApp<Services>`

Public methods and properties:

- `sdk`: underlying MCP SDK server instance
- `connected`: whether the app is currently connected to a transport
- `tools(definitions)`: register tool definitions
- `resources(definitions)`: register resource definitions
- `prompts(definitions)`: register prompt definitions
- `connect(transport)`: bind to an SDK transport
- `close()`: release the transport and registered lifecycle state
- `setLogger(logger)`: replace the logger before connection
- `notifyResourceListChanged()`: emit MCP list-change notifications
- `notifyResourceUpdated(uri)`: emit MCP resource update notifications

Typical usage:

```ts
import { createMcpApp, defineRegistry } from '@mcp-kit/core'

const app = createMcpApp({
  name: 'example',
  version: '1.0.0',
  services: {}
})

app.tools(defineRegistry([]))
app.resources(defineRegistry([]))
app.prompts(defineRegistry([]))
```

## Capability Definition Helpers

### `defineTool(options)`

Defines a tool with:

- `name`
- `inputSchema`
- optional `outputSchema`
- optional `annotations`
- optional `policy`
- `handler({ input, context })`

### `defineResource(options)`

Defines either:

- a static resource via `uri`
- a templated resource via `uriTemplate`

Resource definitions can add:

- `policy`
- `subscriptions`
- template parameter completion through `complete`
- template listing through `list`

### `definePrompt(options)`

Defines a prompt with:

- `name`
- `argsSchema`
- optional `policy`
- `render({ input, context })`

### `defineRegistry(items)`

Builds an explicit readonly registry from tools, prompts, or resources. Use it
at the composition root instead of implicit auto-discovery.

## Completable Helpers

The package re-exports SDK completable helpers so templated resources can
expose parameter completion without another direct SDK dependency:

- `completable()`
- `getCompleter()`
- `isCompletable()`
- `unwrapCompletable()`
- `CompleteCallback`
- `CompletableSchema`

## Main Types

### Request and app contracts

- `McpApp`
- `McpAppOptions`
- `RequestContext`
- `ToolDefinition`
- `ToolOptions`
- `PromptDefinition`
- `ResourceDefinition`
- `StaticResourceDefinition`
- `TemplateResourceDefinition`
- `AnyResourceDefinition`
- `ResourceMetadata`
- `RegistryItem`
- `Schema`
- `InferSchemaOutput`
- `ToolHandlerArgs`
- `Logger`
- `ProgressReporter`
- `ServerRequestContext`
- `ClientRoots`
- `ClientSampling`
- `ClientElicitation`

### Policy contracts

`ToolPolicy` and `CapabilityPolicy` are the main authorization boundary.

Supported fields:

- `requiredScopes?`: minimum scopes required to proceed
- `stepUpScopes?`: stronger scopes that should fail with a step-up style denial
- `requiredConsentScopes?`: scopes that must be present in consent metadata
- `authorize?(context)`: custom authorization hook
- `rateLimit?`: per-tool subject and tenant aware rate limiting
- `timeoutMs?`: execution timeout
- `concurrency?`: max in-flight calls per tool
- `audit?`: force audit logging

### Auth contracts

- `AuthContext`
- `AuthorizationDetails`
- `AuthorizationConsent`
- `AuthorizationStepUp`

`AuthContext` intentionally carries authorization state, not transport
credentials. Raw bearer tokens are not propagated to inner layers.

## Class And Utility Exports

### `McpKitError`

Stable application error with:

- `code`
- `safeMessage`
- internal `cause`

Use this when you want outer layers to distinguish safe client-facing failures
from internal exceptions.

### Runtime utilities

- `silentLogger`: no-op logger implementation
- `timeoutAbortError(signal, timeoutSignal)`: helper used by timeout middleware
- `trackProtocolVersion(transport, onVersion)`: outer transport wrapper for MCP
  protocol negotiation tracking
- `ToolMiddleware`
- `ToolMiddlewareArgs`

`ToolMiddleware` is the extension boundary for cross-cutting tool behavior.
Middleware runs around tool execution, not around prompt or resource handlers.

## `RequestContext` Methods And Fields

`RequestContext.client` hides SDK capability checks and exposes:

- `roots.list()`
- `sampling.createMessage(params)`
- `elicitation.create(params)`
- `elicitation.complete(elicitationId)`

Other important `RequestContext` fields:

- `requestId`
- `correlationId`
- `signal`
- `services`
- `logger`
- `auth`
- `progress`
- `sdk`

See [API core overview](../api-core) for the conceptual API walkthrough.
