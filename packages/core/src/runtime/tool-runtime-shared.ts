import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import type {
  Logger,
  RequestContext,
  Schema,
  ToolDefinition
} from '../definitions.js'
import { McpKitError } from '../definitions.js'

export type ToolMiddlewareArgs<Services> = {
  tool: ToolDefinition<Schema, Services>
  input: unknown
  context: RequestContext<Services>
}

export type ToolMiddleware<Services> = (
  args: ToolMiddlewareArgs<Services>,
  next: () => Promise<CallToolResult>
) => Promise<CallToolResult>

export type ToolMiddlewarePhases<Services> = {
  onError?: readonly ToolMiddleware<Services>[]
  beforePolicy?: readonly ToolMiddleware<Services>[]
  aroundHandler?: readonly ToolMiddleware<Services>[]
  afterResult?: readonly ToolMiddleware<Services>[]
}

export type ToolExecutionOutcome =
  | 'success'
  | 'error'
  | 'denied'
  | 'rate_limited'
  | 'timeout'
  | 'concurrency_limited'

export type ToolExecutionEvent = {
  tool: string
  outcome: ToolExecutionOutcome
  durationMs: number
  correlationId: string
  subject?: string
  tenantId?: string
}

export type ObservabilityAttributeValue = string | number | boolean

export type ObservabilityAttributes = Readonly<
  Record<string, ObservabilityAttributeValue | undefined>
>

export type ObservabilityRedactionTarget = 'log' | 'metric' | 'span'

export type ObservabilityRedactor = (args: {
  target: ObservabilityRedactionTarget
  name: string
  attributes: ObservabilityAttributes
}) => ObservabilityAttributes | void

export type ObservabilityCounter = {
  add(
    value: number,
    attributes?: ObservabilityAttributes
  ): void | Promise<void>
}

export type ObservabilityHistogram = {
  record(
    value: number,
    attributes?: ObservabilityAttributes
  ): void | Promise<void>
}

export type ObservabilityUpDownCounter = {
  add(
    value: number,
    attributes?: ObservabilityAttributes
  ): void | Promise<void>
}

export type ObservabilityMeter = {
  counter(name: string): ObservabilityCounter
  histogram(name: string): ObservabilityHistogram
  upDownCounter(name: string): ObservabilityUpDownCounter
}

export type ObservabilitySpan = {
  setAttributes(attributes: ObservabilityAttributes): void | Promise<void>
  end(options?: {
    status?: 'ok' | 'error'
    attributes?: ObservabilityAttributes
  }): void | Promise<void>
}

export type ObservabilityTracer = {
  startSpan(
    name: string,
    options?: {
      kind?: 'internal' | 'server'
      attributes?: ObservabilityAttributes
    }
  ): ObservabilitySpan
}

export type AppObservability = {
  tracer?: ObservabilityTracer
  meter?: ObservabilityMeter
  logger?: Logger
  redact?: ObservabilityRedactor
  recordToolExecution?(event: ToolExecutionEvent): void | Promise<void>
}

export type ToolObservability = AppObservability

export const defaultObservabilityMetrics = {
  activeSessions: 'mcp_active_sessions',
  httpRequestsTotal: 'mcp_http_requests_total',
  toolCallsTotal: 'mcp_tool_calls_total',
  toolDeniedTotal: 'mcp_tool_denied_total',
  toolDurationMs: 'mcp_tool_duration_ms',
  toolErrorsTotal: 'mcp_tool_errors_total',
  toolTimeoutTotal: 'mcp_tool_timeout_total'
} as const

export function authorizeScopes(
  context: RequestContext<unknown>,
  requiredScopes: readonly string[],
  error:
    | {
        code: 'FORBIDDEN'
        missingMessage: (scope: string) => string
        safeMessage: string
      }
    | {
        code: 'STEP_UP_REQUIRED'
        missingMessage: (scope: string) => string
        safeMessage: string
      } = {
    code: 'FORBIDDEN',
    missingMessage: (scope) => `Missing required scope: ${scope}`,
    safeMessage: 'Permission denied.'
  }
): void {
  if (requiredScopes.length === 0) return
  if (context.auth === undefined) {
    throw new McpKitError({
      code: 'FORBIDDEN',
      message: 'Missing authentication context',
      safeMessage: 'Permission denied.'
    })
  }

  for (const scope of requiredScopes) {
    if (!context.auth.scopes.includes(scope)) {
      throw new McpKitError({
        code: error.code,
        message: error.missingMessage(scope),
        safeMessage: error.safeMessage
      })
    }
  }
}

export function authorizeConsent(
  context: RequestContext<unknown>,
  requiredScopes: readonly string[]
): void {
  if (requiredScopes.length === 0) return
  const consent = context.auth?.authorization?.consent
  if (consent === undefined) {
    throw new McpKitError({
      code: 'CONSENT_REQUIRED',
      message: `Missing consent for scopes: ${requiredScopes.join(', ')}`,
      safeMessage: 'Additional consent is required.'
    })
  }

  for (const scope of requiredScopes) {
    if (!consent.scopes.includes(scope)) {
      throw new McpKitError({
        code: 'CONSENT_REQUIRED',
        message: `Missing consent for scope: ${scope}`,
        safeMessage: 'Additional consent is required.'
      })
    }
  }
}

export function timeoutAbortError(
  signal: AbortSignal,
  timeoutSignal: AbortSignal
): McpKitError {
  const timedOut = timeoutSignal.aborted
  return new McpKitError({
    code: timedOut ? 'TIMEOUT' : 'CANCELLED',
    message: String(signal.reason),
    safeMessage: timedOut
      ? 'The operation timed out.'
      : 'The operation was cancelled.'
  })
}

export function observabilityAttributes(
  attributes: ObservabilityAttributes
): Record<string, ObservabilityAttributeValue> {
  const normalized: Record<string, ObservabilityAttributeValue> = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) normalized[key] = value
  }
  return normalized
}

export function redactObservabilityAttributes(
  observability: Partial<AppObservability> | undefined,
  target: ObservabilityRedactionTarget,
  name: string,
  attributes: ObservabilityAttributes
): Record<string, ObservabilityAttributeValue> {
  const next = observability?.redact?.({
    target,
    name,
    attributes
  })
  return observabilityAttributes(next ?? attributes)
}
