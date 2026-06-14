import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import { defineStoreAdapterMetadata } from '../store-adapter-metadata.js'
import type {
  AuditEvent,
  AuditStore,
  ConcurrencyCheck,
  ConcurrencyPermit,
  ConcurrencyStore,
  IdempotencyBeginResult,
  IdempotencyStore,
  RateLimitCheck,
  RateLimitDecision,
  RateLimitStore
} from './runtime-store-contracts.js'

type RateLimitBucket = { count: number; resetAt: number }
type ActivePermit = { expiresAt: number; owner: string }
type IdempotencyEntry =
  | {
      status: 'in_progress'
      expiresAt: number
      owner: string
      token: string
    }
  | {
      status: 'completed'
      expiresAt: number
      result: CallToolResult
    }

export function createInMemoryRateLimitStore(): RateLimitStore {
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

  return defineStoreAdapterMetadata(new InMemoryRateLimitStore(), {
    adapter: 'InMemoryRateLimitStore',
    support: 'development-and-test'
  })
}

export function createInMemoryConcurrencyStore(): ConcurrencyStore {
  class InMemoryConcurrencyStore implements ConcurrencyStore {
    readonly #active = new Map<string, Map<string, ActivePermit>>()

    acquireConcurrency({
      key,
      limit,
      nowMs,
      leaseMs,
      owner
    }: ConcurrencyCheck): ConcurrencyPermit | undefined {
      const permits = this.#active.get(key) ?? new Map<string, ActivePermit>()
      for (const [token, permit] of permits) {
        if (permit.expiresAt <= nowMs) {
          permits.delete(token)
        }
      }
      if (permits.size >= limit) return undefined

      const token = globalThis.crypto.randomUUID()
      permits.set(token, {
        owner,
        expiresAt: nowMs + leaseMs
      })
      this.#active.set(key, permits)
      return {
        token,
        release: () => {
          const active = this.#active.get(key)
          if (active === undefined) return
          active.delete(token)
          if (active.size === 0) {
            this.#active.delete(key)
            return
          }
        }
      }
    }
  }

  return defineStoreAdapterMetadata(new InMemoryConcurrencyStore(), {
    adapter: 'InMemoryConcurrencyStore',
    support: 'development-and-test'
  })
}

export function createInMemoryIdempotencyStore(): IdempotencyStore {
  class InMemoryIdempotencyStore implements IdempotencyStore {
    readonly #entries = new Map<string, IdempotencyEntry>()

    beginIdempotentRequest({
      key,
      nowMs,
      owner,
      ttlMs
    }: {
      key: string
      nowMs: number
      owner: string
      ttlMs: number
    }): IdempotencyBeginResult {
      const entry = this.#entries.get(key)
      if (entry !== undefined && entry.expiresAt > nowMs) {
        if (entry.status === 'completed') {
          return {
            kind: 'replay',
            result: entry.result
          }
        }
        return {
          kind: 'in_progress',
          retryAfterMs: entry.expiresAt - nowMs
        }
      }

      const token = globalThis.crypto.randomUUID()
      this.#entries.set(key, {
        status: 'in_progress',
        owner,
        token,
        expiresAt: nowMs + ttlMs
      })
      return {
        kind: 'acquired',
        token
      }
    }

    completeIdempotentRequest({
      key,
      token,
      nowMs,
      ttlMs,
      result
    }: {
      key: string
      token: string
      nowMs: number
      ttlMs: number
      result: CallToolResult
    }): void {
      const entry = this.#entries.get(key)
      if (entry?.status !== 'in_progress' || entry.token !== token) return
      this.#entries.set(key, {
        status: 'completed',
        result,
        expiresAt: nowMs + ttlMs
      })
    }

    abandonIdempotentRequest({
      key,
      token
    }: {
      key: string
      token: string
    }): void {
      const entry = this.#entries.get(key)
      if (entry?.status !== 'in_progress' || entry.token !== token) return
      this.#entries.delete(key)
    }
  }

  return defineStoreAdapterMetadata(new InMemoryIdempotencyStore(), {
    adapter: 'InMemoryIdempotencyStore',
    support: 'development-and-test'
  })
}

export function createInMemoryAuditStore(
  sink: AuditEvent[] = []
): AuditStore {
  return defineStoreAdapterMetadata(
    {
      writeAuditEvent(event) {
        sink.push({ ...event })
      }
    },
    {
      adapter: 'InMemoryAuditStore',
      support: 'development-and-test'
    }
  )
}
