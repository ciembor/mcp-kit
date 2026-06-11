import type {
  CallToolResult,
  ToolAnnotations
} from '@modelcontextprotocol/sdk/types.js'

import type {
  CapabilityPolicy,
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

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {}
}

export async function runToolPipeline<Services>(
  tool: ToolDefinition<Schema, Services>,
  input: unknown,
  context: RequestContext<Services>,
  middleware: readonly ToolMiddleware<Services>[]
): Promise<CallToolResult> {
  const builtIn = [
    createErrorMappingMiddleware<Services>(),
    createAuditMiddleware<Services>(),
    createAuthorizationMiddleware<Services>(),
    createRateLimitMiddleware<Services>(),
    createConcurrencyMiddleware<Services>(),
    createTimeoutMiddleware<Services>()
  ]
  const pipeline = [...builtIn, ...middleware]
  let index = -1

  const dispatch = async (position: number): Promise<CallToolResult> => {
    if (position <= index) {
      throw new Error('Tool middleware called next() more than once')
    }
    index = position
    const current = pipeline[position]
    if (current === undefined) {
      return tool.handler({ input: input as never, context })
    }
    return current({ tool, input, context }, () => dispatch(position + 1))
  }

  return dispatch(0)
}

export function toolExecutionError(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true
  }
}

export function authorizeScopes(
  context: RequestContext<unknown>,
  requiredScopes: readonly string[]
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
        code: 'FORBIDDEN',
        message: `Missing required scope: ${scope}`,
        safeMessage: 'Permission denied.'
      })
    }
  }
}

export async function requireCapabilityAccess(
  policy: CapabilityPolicy | undefined,
  context: RequestContext<unknown>
): Promise<void> {
  await policy?.authorize?.(context)
  const requiredScopes = policy?.requiredScopes
  if (requiredScopes === undefined) return
  authorizeScopes(context, requiredScopes)
}

export function toolConfig(tool: ToolDefinition): {
  title?: string
  description?: string
  inputSchema: Schema
  outputSchema?: Schema
  annotations?: ToolAnnotations
} {
  return {
    ...(tool.title === undefined ? {} : { title: tool.title }),
    ...(tool.description === undefined
      ? {}
      : { description: tool.description }),
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema === undefined
      ? {}
      : { outputSchema: tool.outputSchema }),
    ...(tool.annotations === undefined ? {} : { annotations: tool.annotations })
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

const activeToolCalls = new WeakMap<object, number>()
type RateLimitBucket = { count: number; resetAt: number }
const toolRateLimits = new WeakMap<object, Map<string, RateLimitBucket>>()

function createErrorMappingMiddleware<Services>(): ToolMiddleware<Services> {
  return async ({ tool, context }, next) => {
    try {
      return await next()
    } catch (error) {
      if (error instanceof McpKitError) {
        context.logger.warn('Tool execution failed', {
          code: error.code,
          correlationId: context.correlationId,
          tool: tool.name
        })
        return toolExecutionError(error.safeMessage)
      }

      context.logger.error('Unexpected tool execution error', {
        correlationId: context.correlationId,
        tool: tool.name
      })
      return toolExecutionError(
        `Operation failed. Correlation id: ${context.correlationId}`
      )
    }
  }
}

function createAuthorizationMiddleware<Services>(): ToolMiddleware<Services> {
  return async ({ tool, context }, next) => {
    await tool.policy?.authorize?.(context)
    if (tool.policy?.requiredScopes !== undefined) {
      authorizeScopes(context, tool.policy.requiredScopes)
    }
    return next()
  }
}

function createAuditMiddleware<Services>(): ToolMiddleware<Services> {
  return async ({ tool, context }, next) => {
    if (!requiresAudit(tool)) return next()

    try {
      const result = await next()
      writeAuditEvent(context.logger, {
        correlationId: context.correlationId,
        outcome: result.isError === true ? 'error' : 'success',
        subject: context.auth?.subject,
        tenantId: context.auth?.tenantId,
        tool: tool.name
      })
      return result
    } catch (error) {
      writeAuditEvent(context.logger, {
        correlationId: context.correlationId,
        outcome:
          error instanceof McpKitError && error.code === 'FORBIDDEN'
            ? 'denied'
            : 'error',
        subject: context.auth?.subject,
        tenantId: context.auth?.tenantId,
        tool: tool.name
      })
      throw error
    }
  }
}

function createConcurrencyMiddleware<Services>(): ToolMiddleware<Services> {
  return async ({ tool }, next) => {
    const limit = tool.policy?.concurrency
    if (limit === undefined) return next()

    const active = activeToolCalls.get(tool) ?? 0
    if (active >= limit) {
      throw new McpKitError({
        code: 'CONCURRENCY_LIMIT',
        message: `Tool ${tool.name} concurrency limit exceeded`,
        safeMessage: 'The operation is busy. Try again later.'
      })
    }

    activeToolCalls.set(tool, active + 1)
    try {
      return await next()
    } finally {
      activeToolCalls.set(tool, activeToolCalls.get(tool)! - 1)
    }
  }
}

function createRateLimitMiddleware<Services>(): ToolMiddleware<Services> {
  return async ({ tool, context }, next) => {
    const rateLimit = tool.policy?.rateLimit
    if (rateLimit === undefined) return next()

    const now = Date.now()
    const bucketKey = [
      tool.name,
      context.auth?.subject ?? 'anonymous',
      context.auth?.tenantId ?? 'global'
    ].join(':')
    const buckets = rateLimitBuckets(tool)
    toolRateLimits.set(tool, buckets)
    const current = buckets.get(bucketKey)

    if (current === undefined || current.resetAt <= now) {
      buckets.set(bucketKey, {
        count: 1,
        resetAt: now + rateLimit.windowMs
      })
      return next()
    }

    if (current.count >= rateLimit.maxCalls) {
      throw new McpKitError({
        code: 'RATE_LIMIT',
        message: `Rate limit exceeded for tool ${tool.name}`,
        safeMessage: 'Rate limit exceeded. Try again later.'
      })
    }

    current.count += 1
    return next()
  }
}

function rateLimitBuckets(tool: object): Map<string, RateLimitBucket> {
  return toolRateLimits.get(tool) ?? new Map<string, RateLimitBucket>()
}

function requiresAudit(tool: ToolDefinition): boolean {
  return (
    tool.policy?.audit === true ||
    tool.policy?.requiredScopes !== undefined ||
    tool.policy?.authorize !== undefined
  )
}

function writeAuditEvent(
  logger: Logger,
  event: {
    correlationId: string
    outcome: 'success' | 'error' | 'denied'
    subject: string | undefined
    tenantId: string | undefined
    tool: string
  }
): void {
  logger.info('Audit event', {
    correlationId: event.correlationId,
    outcome: event.outcome,
    ...(event.subject === undefined ? {} : { subject: event.subject }),
    ...(event.tenantId === undefined ? {} : { tenantId: event.tenantId }),
    tool: event.tool
  })
}

function createTimeoutMiddleware<Services>(): ToolMiddleware<Services> {
  return async ({ tool, context }, next) => {
    const timeoutMs = tool.policy?.timeoutMs
    if (timeoutMs === undefined) return next()

    const timeoutController = new AbortController()
    const timer = setTimeout(() => {
      timeoutController.abort(new Error(`Timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    const originalSignal = context.signal
    context.signal = AbortSignal.any([originalSignal, timeoutController.signal])

    try {
      return await Promise.race([
        next(),
        new Promise<never>((_resolve, reject) => {
          context.signal.addEventListener(
            'abort',
            () =>
              reject(
                timeoutAbortError(context.signal, timeoutController.signal)
              ),
            { once: true }
          )
        })
      ])
    } finally {
      clearTimeout(timer)
      context.signal = originalSignal
    }
  }
}
