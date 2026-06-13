import type {
  Logger,
  RequestContext,
  Schema,
  ToolDefinition
} from '../definitions.js'
import { McpKitError } from '../definitions.js'
import {
  authorizeConsent,
  authorizeScopes,
  timeoutAbortError,
  type ToolMiddleware
} from './tool-runtime-shared.js'
import {
  assertDestructiveConfirmation,
  validateToolResultLimits
} from './tool-io.js'

type RateLimitBucket = { count: number; resetAt: number }

export type RateLimitCheck = {
  key: string
  windowMs: number
  maxCalls: number
  nowMs: number
}

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number }

export type RateLimitStore = {
  checkRateLimit(
    check: RateLimitCheck
  ): RateLimitDecision | Promise<RateLimitDecision>
}

export type ConcurrencyCheck = {
  key: string
  limit: number
}

export type ConcurrencyPermit = {
  release(): void | Promise<void>
}

export type ConcurrencyStore = {
  acquireConcurrency(
    check: ConcurrencyCheck
  ): ConcurrencyPermit | undefined | Promise<ConcurrencyPermit | undefined>
}

export type RuntimePolicyStores = {
  rateLimit: RateLimitStore
  concurrency: ConcurrencyStore
}

export type RuntimePolicyStoreOptions = Partial<RuntimePolicyStores>

export function createInMemoryRuntimePolicyStores(): RuntimePolicyStores {
  return {
    rateLimit: new InMemoryRateLimitStore(),
    concurrency: new InMemoryConcurrencyStore()
  }
}

export function resolveRuntimePolicyStores(
  stores: RuntimePolicyStoreOptions | undefined
): RuntimePolicyStores {
  if (stores?.rateLimit !== undefined && stores.concurrency !== undefined) {
    return {
      rateLimit: stores.rateLimit,
      concurrency: stores.concurrency
    }
  }
  const fallback = createInMemoryRuntimePolicyStores()
  return {
    rateLimit: stores?.rateLimit ?? fallback.rateLimit,
    concurrency: stores?.concurrency ?? fallback.concurrency
  }
}

export function createAuthorizationMiddleware<
  Services
>(): ToolMiddleware<Services> {
  return async ({ tool, context }, next) => {
    await tool.policy?.authorize?.(context)
    authorizeRequiredScopes(tool, context)
    authorizeStepUpScopes(tool, context)
    authorizeConsentScopes(tool, context)
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

export function createConcurrencyMiddleware<Services>(
  store: ConcurrencyStore
): ToolMiddleware<Services> {
  return async ({ tool }, next) => {
    const limit = tool.policy?.concurrency
    if (limit === undefined) return next()

    const permit = await store.acquireConcurrency({
      key: concurrencyKey(tool.name),
      limit
    })
    if (permit === undefined) {
      throw new McpKitError({
        code: 'CONCURRENCY_LIMIT',
        message: `Tool ${tool.name} concurrency limit exceeded`,
        safeMessage: 'The operation is busy. Try again later.'
      })
    }

    try {
      return await next()
    } finally {
      await permit.release()
    }
  }
}

export function createRateLimitMiddleware<Services>(
  store: RateLimitStore
): ToolMiddleware<Services> {
  return async ({ tool, context }, next) => {
    const rateLimit = tool.policy?.rateLimit
    if (rateLimit === undefined) return next()

    const decision = await store.checkRateLimit({
      key: rateLimitKey(tool.name, context),
      windowMs: rateLimit.windowMs,
      maxCalls: rateLimit.maxCalls,
      nowMs: Date.now()
    })
    if (!decision.allowed) {
      throw new McpKitError({
        code: 'RATE_LIMIT',
        message: `Rate limit exceeded for tool ${tool.name}`,
        safeMessage: 'Rate limit exceeded. Try again later.'
      })
    }

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

export function createDestructiveMiddleware<
  Services
>(): ToolMiddleware<Services> {
  return async ({ tool, input }, next) => {
    assertDestructiveConfirmation(tool, input)
    return next()
  }
}

export function createResultLimitMiddleware<
  Services
>(): ToolMiddleware<Services> {
  return async ({ tool }, next) => {
    const result = await next()
    validateToolResultLimits(tool, result)
    return result
  }
}

function auditFailureOutcome(error: unknown): 'denied' | 'error' {
  return error instanceof McpKitError && error.code === 'FORBIDDEN'
    ? 'denied'
    : 'error'
}

function requiresAudit(tool: ToolDefinition): boolean {
  const policy = tool.policy
  return (
    policy?.audit === true ||
    hasAuthorizationRequirement(policy) ||
    policy?.destructive !== undefined
  )
}

function concurrencyKey(toolName: string): string {
  return toolName
}

function rateLimitKey(
  toolName: string,
  context: RequestContext<unknown>
): string {
  return [
    toolName,
    context.auth?.subject ?? 'anonymous',
    context.auth?.tenantId ?? 'global'
  ].join(':')
}

class InMemoryConcurrencyStore implements ConcurrencyStore {
  readonly #active = new Map<string, number>()

  acquireConcurrency({
    key,
    limit
  }: ConcurrencyCheck): ConcurrencyPermit | undefined {
    const active = this.#active.get(key) ?? 0
    if (active >= limit) return undefined

    this.#active.set(key, active + 1)
    return {
      release: () => {
        const next = (this.#active.get(key) ?? 1) - 1
        if (next <= 0) {
          this.#active.delete(key)
          return
        }
        this.#active.set(key, next)
      }
    }
  }
}

class InMemoryRateLimitStore implements RateLimitStore {
  readonly #buckets = new Map<string, RateLimitBucket>()

  checkRateLimit({
    key,
    windowMs,
    maxCalls,
    nowMs
  }: RateLimitCheck): RateLimitDecision {
    const current = this.#buckets.get(key)
    if (current === undefined || current.resetAt <= nowMs) {
      this.#buckets.set(key, {
        count: 1,
        resetAt: nowMs + windowMs
      })
      return { allowed: true }
    }

    if (current.count >= maxCalls) {
      return { allowed: false, retryAfterMs: current.resetAt - nowMs }
    }

    current.count += 1
    return { allowed: true }
  }
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

function authorizeRequiredScopes<Services>(
  tool: ToolDefinition<Schema, Services>,
  context: RequestContext<unknown>
): void {
  if (tool.policy?.requiredScopes !== undefined) {
    authorizeScopes(context, tool.policy.requiredScopes)
  }
}

function authorizeStepUpScopes<Services>(
  tool: ToolDefinition<Schema, Services>,
  context: RequestContext<unknown>
): void {
  if (tool.policy?.stepUpScopes === undefined) return
  authorizeScopes(context, tool.policy.stepUpScopes, {
    code: 'STEP_UP_REQUIRED',
    missingMessage: (scope) =>
      `Step-up authorization required for scope: ${scope}`,
    safeMessage: 'Additional authorization is required.'
  })
}

function authorizeConsentScopes<Services>(
  tool: ToolDefinition<Schema, Services>,
  context: RequestContext<unknown>
): void {
  if (tool.policy?.requiredConsentScopes !== undefined) {
    authorizeConsent(context, tool.policy.requiredConsentScopes)
  }
}

function hasAuthorizationRequirement(
  policy: ToolDefinition['policy']
): boolean {
  return (
    policy?.requiredScopes !== undefined ||
    policy?.stepUpScopes !== undefined ||
    policy?.requiredConsentScopes !== undefined ||
    policy?.authorize !== undefined
  )
}
