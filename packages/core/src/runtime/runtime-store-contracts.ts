import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

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

export type IdempotencyStore = {
  getIdempotentResult(
    key: string
  ): CallToolResult | undefined | Promise<CallToolResult | undefined>
  storeIdempotentResult(
    key: string,
    result: CallToolResult
  ): void | Promise<void>
}

export type AuditEvent = {
  correlationId: string
  outcome: 'success' | 'error' | 'denied'
  subject?: string
  tenantId?: string
  tool: string
}

export type AuditStore = {
  writeAuditEvent(event: AuditEvent): void | Promise<void>
}

export type RuntimePolicyStores = {
  rateLimit: RateLimitStore
  concurrency: ConcurrencyStore
  idempotency: IdempotencyStore
  audit: AuditStore
}

export type RuntimePolicyStoreOptions = Partial<RuntimePolicyStores>
