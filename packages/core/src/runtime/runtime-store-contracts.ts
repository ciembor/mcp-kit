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
  leaseMs: number
  nowMs: number
  owner: string
}

export type ConcurrencyPermit = {
  token: string
  release(): void | Promise<void>
}

export type ConcurrencyStore = {
  acquireConcurrency(
    check: ConcurrencyCheck
  ): ConcurrencyPermit | undefined | Promise<ConcurrencyPermit | undefined>
}

export type IdempotencyStore = {
  beginIdempotentRequest(args: {
    key: string
    nowMs: number
    owner: string
    ttlMs: number
  }):
    | IdempotencyBeginResult
    | Promise<IdempotencyBeginResult>
  completeIdempotentRequest(args: {
    key: string
    token: string
    nowMs: number
    ttlMs: number
    result: CallToolResult
  }): void | Promise<void>
  abandonIdempotentRequest(args: {
    key: string
    token: string
  }): void | Promise<void>
}

export type IdempotencyBeginResult =
  | {
      kind: 'acquired'
      token: string
    }
  | {
      kind: 'replay'
      result: CallToolResult
    }
  | {
      kind: 'in_progress'
      retryAfterMs?: number
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
