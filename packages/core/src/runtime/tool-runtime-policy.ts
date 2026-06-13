import type { Logger, RequestContext, ToolDefinition } from '../definitions.js'
import { McpKitError } from '../definitions.js'
import {
  authorizeConsent,
  authorizeScopes,
  timeoutAbortError,
  type ToolMiddleware
} from './tool-runtime-shared.js'

const activeToolCalls = new WeakMap<object, number>()
type RateLimitBucket = { count: number; resetAt: number }
const toolRateLimits = new WeakMap<object, Map<string, RateLimitBucket>>()

export function createAuthorizationMiddleware<
  Services
>(): ToolMiddleware<Services> {
  return async ({ tool, context }, next) => {
    await tool.policy?.authorize?.(context)
    if (tool.policy?.requiredScopes !== undefined) {
      authorizeScopes(context, tool.policy.requiredScopes)
    }
    if (tool.policy?.stepUpScopes !== undefined) {
      authorizeScopes(context, tool.policy.stepUpScopes, {
        code: 'STEP_UP_REQUIRED',
        missingMessage: (scope) =>
          `Step-up authorization required for scope: ${scope}`,
        safeMessage: 'Additional authorization is required.'
      })
    }
    if (tool.policy?.requiredConsentScopes !== undefined) {
      authorizeConsent(context, tool.policy.requiredConsentScopes)
    }
    return next()
  }
}

export function createAuditMiddleware<Services>(): ToolMiddleware<Services> {
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
        outcome: auditFailureOutcome(error),
        subject: context.auth?.subject,
        tenantId: context.auth?.tenantId,
        tool: tool.name
      })
      throw error
    }
  }
}

export function createConcurrencyMiddleware<
  Services
>(): ToolMiddleware<Services> {
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

export function createRateLimitMiddleware<
  Services
>(): ToolMiddleware<Services> {
  return async ({ tool, context }, next) => {
    const rateLimit = tool.policy?.rateLimit
    if (rateLimit === undefined) return next()

    const now = Date.now()
    const bucketKey = rateLimitBucketKey(tool.name, context)
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

export function createTimeoutMiddleware<Services>(): ToolMiddleware<Services> {
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

function auditFailureOutcome(error: unknown): 'denied' | 'error' {
  return error instanceof McpKitError && error.code === 'FORBIDDEN'
    ? 'denied'
    : 'error'
}

function requiresAudit(tool: ToolDefinition): boolean {
  return (
    tool.policy?.audit === true ||
    tool.policy?.requiredScopes !== undefined ||
    tool.policy?.stepUpScopes !== undefined ||
    tool.policy?.requiredConsentScopes !== undefined ||
    tool.policy?.authorize !== undefined
  )
}

function rateLimitBuckets(tool: object): Map<string, RateLimitBucket> {
  return toolRateLimits.get(tool) ?? new Map<string, RateLimitBucket>()
}

function rateLimitBucketKey(
  toolName: string,
  context: RequestContext<unknown>
): string {
  return [
    toolName,
    context.auth?.subject ?? 'anonymous',
    context.auth?.tenantId ?? 'global'
  ].join(':')
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
