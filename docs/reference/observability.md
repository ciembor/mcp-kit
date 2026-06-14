# Observability

`mcp-kit` exposes observability as a transport-agnostic API instead of binding core policy code to one telemetry SDK.

## Public API

Pass `observability` to `createMcpApp()` and, for HTTP metrics, to `runStreamableHttp()`:

```ts
import {
  createMcpApp,
  defaultObservabilityMetrics,
  type AppObservability
} from '@mcp-kit/core'
import { runStreamableHttp } from '@mcp-kit/node'

const observability: AppObservability = {
  tracer,
  meter,
  logger,
  redact({ target, name, attributes }) {
    return {
      ...attributes,
      ...(target === 'metric' ? { 'mcp.auth.subject': undefined } : {}),
      ...(name === defaultObservabilityMetrics.httpRequestsTotal
        ? { 'url.path': '/redacted' }
        : {})
    }
  }
}

const app = createMcpApp({
  name: 'example',
  version: '1.0.0',
  services,
  observability
})

await runStreamableHttp(() => app, {
  port: 3000,
  observability
})
```

Available fields:

| Field     | Use |
| --------- | --- |
| `tracer`  | Start spans for tool, prompt, resource, and HTTP request execution. |
| `meter`   | Emit counters, histograms, and up-down counters without choosing one metrics backend. |
| `logger`  | Mirror observability events into structured logs after redaction. |
| `redact`  | Rewrite or drop attributes before they reach logs, metrics, or spans. |
| `recordToolExecution` | Legacy compatibility hook for existing tool-only integrations. |

## Default Metrics

`defaultObservabilityMetrics` exports the canonical metric names:

| Metric | Type | Emitted from |
| ------ | ---- | ------------ |
| `mcp_tool_calls_total` | Counter | Every tool execution with `mcp.outcome`. |
| `mcp_tool_errors_total` | Counter | Tool executions with outcome `error`. |
| `mcp_tool_duration_ms` | Histogram | Every tool execution duration. |
| `mcp_tool_denied_total` | Counter | Tool executions with outcome `denied`. |
| `mcp_tool_timeout_total` | Counter | Tool executions with outcome `timeout`. |
| `mcp_http_requests_total` | Counter | Every Streamable HTTP request handled by `@mcp-kit/node`. |
| `mcp_active_sessions` | Up-down counter | Stateful session opens and closes in one process. |

## Outcome Mapping

Tool metrics and tool spans use these outcomes:

| Runtime result | `mcp.outcome` |
| -------------- | ------------- |
| Successful handler result | `success` |
| `FORBIDDEN`, `STEP_UP_REQUIRED`, `CONSENT_REQUIRED` | `denied` |
| `RATE_LIMIT` | `rate_limited` |
| `CONCURRENCY_LIMIT` | `concurrency_limited` |
| `TIMEOUT` | `timeout` |
| Unexpected exception or other mapped error | `error` |

Only `error`, `denied`, and `timeout` get dedicated counters. `rate_limited` and `concurrency_limited` remain visible through `mcp_tool_calls_total{mcp.outcome=...}` and through spans/logs.

## Default Attributes

Common tool attributes:

| Attribute | Meaning |
| --------- | ------- |
| `mcp.capability.kind` | `tool`, `prompt`, or `resource` |
| `mcp.request.correlation_id` | Correlation id generated for the request context |
| `mcp.outcome` | Normalized execution outcome |
| `mcp.duration_ms` | Tool duration in milliseconds |
| `mcp.tool.name` | Tool name |
| `mcp.prompt.name` | Prompt name |
| `mcp.resource.name` | Matched resource name |
| `mcp.resource.uri` | Requested resource URI |
| `mcp.auth.subject` | Caller subject when available |
| `mcp.auth.tenant_id` | Caller tenant when available |
| `mcp.auth.client_id` | Caller client id when available |

HTTP request attributes:

| Attribute | Meaning |
| --------- | ------- |
| `http.method` | HTTP method |
| `http.route` | Configured MCP route |
| `http.status_code` | Final HTTP status |
| `url.path` | Request pathname before or after redaction |
| `mcp.session.mode` | `stateless` or `stateful` |

## Cardinality Rules

- Keep `mcp.tool.name`, `mcp.prompt.name`, and `mcp.resource.name` low-cardinality. They should come from registered capability names, not user input.
- Redact or drop `mcp.request.correlation_id` and `mcp.auth.subject` before metrics in most production backends.
- Treat `mcp.resource.uri` and `url.path` as potentially high-cardinality unless your redactor normalizes them.
- Prefer tenant ids only if the tenant set is operationally bounded; otherwise redact them from metrics and keep them in logs or traces only.

## OpenTelemetry Example

Use your own adapter around OTel APIs:

```ts
const observability: AppObservability = {
  tracer: {
    startSpan(name, options) {
      const span = otelTracer.startSpan(name, {
        kind: options?.kind === 'server' ? 1 : 0,
        attributes: options?.attributes
      })
      return {
        setAttributes(attributes) {
          span.setAttributes(attributes)
        },
        end(options) {
          if (options?.attributes) span.setAttributes(options.attributes)
          if (options?.status === 'error') {
            span.setStatus({ code: 2 })
          }
          span.end()
        }
      }
    }
  },
  meter: {
    counter: (name) => ({ add: (value, attributes) => otelMeter.createCounter(name).add(value, attributes) }),
    histogram: (name) => ({ record: (value, attributes) => otelMeter.createHistogram(name).record(value, attributes) }),
    upDownCounter: (name) => ({ add: (value, attributes) => otelMeter.createUpDownCounter(name).add(value, attributes) })
  }
}
```

## Prometheus Example

Use counters and histograms from your own registry:

```ts
const observability: AppObservability = {
  meter: {
    counter: (name) => ({ add: (value, attributes) => promCounters[name].inc(attributes, value) }),
    histogram: (name) => ({ record: (value, attributes) => promHistograms[name].observe(attributes, value) }),
    upDownCounter: (name) => ({ add: (value, attributes) => promGauges[name].inc(attributes, value) })
  },
  redact({ target, attributes }) {
    if (target !== 'metric') return attributes
    return {
      ...attributes,
      'mcp.request.correlation_id': undefined,
      'mcp.auth.subject': undefined,
      'mcp.resource.uri': undefined
    }
  }
}
```
