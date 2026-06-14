# `@mcp-kit/core`

`@mcp-kit/core` is the application API. Use it to assemble an MCP app, define capabilities, describe runtime policy, and handle long-running jobs. It does not start stdio or HTTP; runtimes live in outer packages.

## App Assembly

```ts
import { createMcpApp, defineRegistry } from '@mcp-kit/core'

const app = createMcpApp({
  name: 'example',
  version: '1.0.0',
  services
})

app.tools(defineRegistry([tool]))
app.resources(defineRegistry([resource]))
app.prompts(defineRegistry([prompt]))
```

| Export                  | Use                                                      |
| ----------------------- | -------------------------------------------------------- |
| `createMcpApp(options)` | Build an app without binding it to a transport.          |
| `defineRegistry(items)` | Register public tools, resources, or prompts explicitly. |
| `packageInfo`           | Published package name and version.                      |

`McpAppOptions` includes `name`, `version`, `services`, optional `logger`, optional `instructions`, optional tool `middleware`, optional `middlewarePhases`, optional `policyStores`, and optional `observability`.

`McpApp` exposes `sdk`, `connected`, `tools()`, `resources()`, `prompts()`, `connect()`, `close()`, `setLogger()`, `notifyResourceListChanged()`, and `notifyResourceUpdated(uri)`.

## Capabilities

| Export                    | Use                                                         |
| ------------------------- | ----------------------------------------------------------- |
| `defineTool(options)`     | Define a tool with schemas, policy, and a handler.          |
| `defineResource(options)` | Define a static or templated resource.                      |
| `definePrompt(options)`   | Define a prompt with argument schema, policy, and renderer. |

Tool handlers receive `{ input, context }` and return MCP content plus optional structured output. Prompt renderers receive `{ input, context }`. Resource handlers use either a static URI or a URI template.

Keep MCP definitions near the feature that owns the behavior. Keep registration at the composition root.

## Request Context

`RequestContext` is what handlers use at runtime.

| Field                        | Use                                                                      |
| ---------------------------- | ------------------------------------------------------------------------ |
| `requestId`, `correlationId` | Request tracing.                                                         |
| `signal`                     | Cancellation and timeout handling.                                       |
| `services`                   | Application dependencies injected at app creation.                       |
| `logger`                     | Transport-independent logging.                                           |
| `auth`                       | Authenticated subject, tenant, scopes, and consent state when available. |
| `progress`                   | Progress reporting for clients that support it.                          |
| `sdk`                        | Escape hatch for advanced SDK access.                                    |

`RequestContext.client` wraps optional client capabilities:

| Helper      | Method                                                              |
| ----------- | ------------------------------------------------------------------- |
| Roots       | `roots.list()`                                                      |
| Sampling    | `sampling.createMessage(params)`                                    |
| Elicitation | `elicitation.create(params)`, `elicitation.complete(elicitationId)` |

`RequestContext.io` wraps guarded tool I/O:

| Helper                 | Method                                              |
| ---------------------- | --------------------------------------------------- |
| Files                  | `files.resolvePath(candidate)`, `files.roots()`     |
| HTTP                   | `http.fetch(url, init?)`, `http.assertAllowed(url)` |
| Results                | `results.paginate({ items, limit, cursor })`        |
| Destructive operations | `destructive.assertConfirmation(input)`             |

## Policy

`ToolPolicy` and `CapabilityPolicy` describe checks the runtime can enforce around a capability.

| Field                   | Use                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `requiredScopes`        | Minimum scopes needed to run.                                                              |
| `stepUpScopes`          | Stronger scopes that should return a step-up denial.                                       |
| `requiredConsentScopes` | Consent scopes tied to subject and client.                                                 |
| `input`                 | Per-field validation for strings, numbers, collections, URLs, hosts, and filesystem paths. |
| `filesystem`            | File roots for `context.io.files`.                                                         |
| `outboundHttp`          | Host allowlist and SSRF guard for `context.io.http`.                                       |
| `output`                | Result size and pagination limits.                                                         |
| `destructive`           | Confirmation rules for destructive writes.                                                 |
| `idempotency`           | Deduplicate retried write tools by an input idempotency key.                               |
| `authorize(context)`    | Custom authorization hook.                                                                 |
| `rateLimit`             | Subject and tenant aware rate limits.                                                      |
| `timeoutMs`             | Tool timeout.                                                                              |
| `concurrency`           | Per-tool in-flight limit.                                                                  |
| `audit`                 | Force audit logging.                                                                       |

Use `context.io.http.fetch()` for outbound calls. It checks the tool allowlist at the point of use and does not follow redirects by default. `assertAllowed()` is available for lower-level adapters, but it does not perform the request.

`outboundHttp` requires an `outputSchema`. That keeps downstream responses shaped before they leave the tool.

Auth-related types include `AuthContext`, `AuthorizationDetails`, `AuthorizationConsent`, and `AuthorizationStepUp`.

`policyStores` lets production deployments back rate limits, concurrency, and idempotency with shared storage. If you do not pass it, the app uses in-memory stores, which are fine for tests and one local process but do not survive restarts or coordinate several replicas.

Reference Redis adapters are available for shared policy enforcement and worker wakeups:

| Export                         | Use                                                        |
| ------------------------------ | ---------------------------------------------------------- |
| `createRedisRateLimitStore()`  | Share rate limits across replicas.                         |
| `createRedisConcurrencyStore()`| Share per-tool concurrency leases across replicas.         |
| `createRedisIdempotencyStore()`| Deduplicate write retries across replicas and restarts.    |
| `createRedisJobQueue()`        | Wake workers from a shared queue outside one process.      |
| `redisPolicyScripts`           | Reuse the shipped Redis script identifiers in test doubles.|
| `createPostgresJobStore()`     | Persist async jobs, leases, and results in Postgres.       |
| `createPostgresAuditStore()`   | Persist tool audit rows in Postgres.                       |
| `createPostgresIdempotencyStore()` | Persist idempotency reservations and replayable results. |
| `postgresJobSchema`            | Emit reference DDL for the Postgres job table and indexes. |
| `postgresPolicySchema`         | Emit reference DDL for audit and idempotency tables.       |

```ts
createMcpApp({
  name: 'example',
  version: '1.0.0',
  services,
  policyStores: {
    rateLimit: redisRateLimitStore,
    concurrency: redisConcurrencyStore,
    idempotency: redisIdempotencyStore
  }
})
```

For write tools, set `policy.idempotency` when clients may retry the same mutation:

```ts
defineTool({
  name: 'create-payment',
  inputSchema: z.object({ idempotencyKey: z.string() }),
  outputSchema,
  policy: {
    effects: 'write',
    idempotency: true
  },
  handler
})
```

The default key field is `idempotencyKey`. Use `idempotency: { keyField: 'requestId' }` if your API already has a different field. Production deployments should provide an `IdempotencyStore` outside the process.

Detailed production guarantees for `JobStore`, `JobQueue`, `RateLimitStore`, `ConcurrencyStore`, `AuditStore`, and `IdempotencyStore` live in [Store Guarantees](./store-guarantees.md). `SessionStore` is documented there as a single-process contract, not a production cross-instance store, so `@mcp-kit/core` does not ship a shared Redis session adapter.

The Postgres adapters accept a minimal `PostgresLikeClient` with `query(sql, params)`, so you can wire `pg`, `postgres.js`, Neon, or a pool wrapper without coupling `@mcp-kit/core` to one driver.

## Errors And Utilities

| Export                                       | Use                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------- |
| `McpKitError`                                | Application error with `code`, `safeMessage`, and internal `cause`. |
| `silentLogger`                               | No-op logger.                                                       |
| `timeoutAbortError(signal, timeoutSignal)`   | Build the timeout error used by middleware.                         |
| `trackProtocolVersion(transport, onVersion)` | Track negotiated MCP protocol version around a transport.           |
| `ToolMiddleware`, `ToolMiddlewareArgs`       | Extend cross-cutting tool behavior.                                 |

Middleware wraps tool execution. It does not wrap prompt or resource handlers.

Use `middlewarePhases` when placement matters:

| Phase           | Runs around                                         |
| --------------- | --------------------------------------------------- |
| `onError`       | Built-in policy and handler errors before mapping.  |
| `beforePolicy`  | The full tool request, including built-in policy.   |
| `aroundHandler` | The tool handler after built-in policy has passed.  |
| `afterResult`   | The validated handler result before it is returned. |

The older `middleware` option is still supported and behaves like `aroundHandler`.

`observability` receives one event per tool call with `tool`, `outcome`, `durationMs`, `correlationId`, and optional subject or tenant. Use it to connect your metrics backend:

```ts
createMcpApp({
  name: 'example',
  version: '1.0.0',
  services,
  observability: {
    recordToolExecution(event) {
      metrics.counter(`mcp_tool_${event.outcome}`).add(1, {
        tool: event.tool
      })
      metrics.histogram('mcp_tool_latency_ms').record(event.durationMs, {
        tool: event.tool
      })
    }
  }
})
```

## Completion Helpers

`completable()`, `getCompleter()`, `isCompletable()`, and `unwrapCompletable()` are re-exported from the MCP SDK so resources and prompts can support completion without importing the SDK directly.

Related types are `CompleteCallback` and `CompletableSchema`.

## Async Jobs

`createAsyncJobOperation(options)` builds a start/status/result/cancel workflow for long-running work.

It uses a `JobStore` for persisted state and worker leases, and a `JobQueue` for waking workers. The returned operation exposes `start(input)`, `status(jobId)`, `result(jobId)`, `cancel(jobId)`, `worker(workerId).runNext()`, `worker(workerId).runUntilIdle()`, `worker(workerId).waitForWork(signal)`, and `toTask(job, adapter)`.

Jobs include `pollAfterMs` and `expiresAt` so clients know when to poll and when old results may disappear.

`JobStore` and `JobQueue` minimum production guarantees are documented in [Store Guarantees](./store-guarantees.md).

## Main Types

| Area           | Types                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| App            | `McpApp`, `McpAppOptions`, `RequestContext`, `ServerRequestContext`                                                                                                                              |
| Capabilities   | `ToolDefinition`, `ToolOptions`, `PromptDefinition`, `ResourceDefinition`, `StaticResourceDefinition`, `TemplateResourceDefinition`, `AnyResourceDefinition`, `ResourceMetadata`, `RegistryItem` |
| Schemas        | `Schema`, `InferSchemaOutput`                                                                                                                                                                    |
| Handlers       | `ToolHandlerArgs`, `ProgressReporter`                                                                                                                                                            |
| Client helpers | `ClientRoots`, `ClientSampling`, `ClientElicitation`                                                                                                                                             |
| Logging        | `Logger`                                                                                                                                                                                         |
| Observability  | `ToolObservability`, `ToolExecutionEvent`, `ToolExecutionOutcome`                                                                                                                                |
| Policy stores  | `RateLimitStore`, `ConcurrencyStore`, `IdempotencyStore`, `RuntimePolicyStores`                                                                                                                  |

See [Core API](../api-core.md) for a shorter walkthrough.
