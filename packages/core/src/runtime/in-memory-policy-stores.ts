import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import { defineStoreAdapterMetadata } from '../store-adapter-metadata.js'
import type {
  AuditEvent,
  AuditStore,
  ConcurrencyCheck,
  ConcurrencyPermit,
  ConcurrencyStore,
  IdempotencyStore,
  RateLimitCheck,
  RateLimitDecision,
  RateLimitStore
} from './runtime-store-contracts.js'

type RateLimitBucket = { count: number; resetAt: number }

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

  return defineStoreAdapterMetadata(new InMemoryConcurrencyStore(), {
    adapter: 'InMemoryConcurrencyStore',
    support: 'development-and-test'
  })
}

export function createInMemoryIdempotencyStore(): IdempotencyStore {
  class InMemoryIdempotencyStore implements IdempotencyStore {
    readonly #results = new Map<string, CallToolResult>()

    getIdempotentResult(key: string): CallToolResult | undefined {
      return this.#results.get(key)
    }

    storeIdempotentResult(key: string, result: CallToolResult): void {
      this.#results.set(key, result)
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
