import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import type { RequestContext, Schema, ToolDefinition } from '../definitions.js'
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

export type ToolObservability = {
  recordToolExecution(event: ToolExecutionEvent): void | Promise<void>
}

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
