import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import type {
  ConcurrencyCheck,
  ConcurrencyPermit,
  ConcurrencyStore,
  IdempotencyBeginResult,
  IdempotencyStore,
  RateLimitCheck,
  RateLimitDecision,
  RateLimitStore
} from './runtime-store-contracts.js'
import type { RedisLikeClient } from './redis-store-client.js'

const RATE_LIMIT_SCRIPT = '-- mcp-kit:rate-limit'
const CONCURRENCY_ACQUIRE_SCRIPT = '-- mcp-kit:concurrency-acquire'
const IDEMPOTENCY_BEGIN_SCRIPT = '-- mcp-kit:idempotency-begin'
const IDEMPOTENCY_COMPLETE_SCRIPT = '-- mcp-kit:idempotency-complete'
const IDEMPOTENCY_ABANDON_SCRIPT = '-- mcp-kit:idempotency-abandon'

export function createRedisRateLimitStore(
  client: RedisLikeClient,
  options: { keyPrefix?: string } = {}
): RateLimitStore {
  const keyPrefix = options.keyPrefix ?? 'mcp-kit:rate-limit:'
  return {
    async checkRateLimit(check: RateLimitCheck): Promise<RateLimitDecision> {
      const result = await client.eval<readonly [number, number]>(
        RATE_LIMIT_SCRIPT,
        [`${keyPrefix}${check.key}`],
        [
          String(check.nowMs),
          String(check.windowMs),
          String(check.maxCalls)
        ]
      )
      return result[0] === 1
        ? { allowed: true }
        : { allowed: false, retryAfterMs: result[1] }
    }
  }
}

export function createRedisConcurrencyStore(
  client: RedisLikeClient,
  options: { keyPrefix?: string } = {}
): ConcurrencyStore {
  const keyPrefix = options.keyPrefix ?? 'mcp-kit:concurrency:'
  return {
    async acquireConcurrency(
      check: ConcurrencyCheck
    ): Promise<ConcurrencyPermit | undefined> {
      const token = globalThis.crypto.randomUUID()
      const acquired = await client.eval<number>(
        CONCURRENCY_ACQUIRE_SCRIPT,
        [`${keyPrefix}${check.key}`],
        [
          String(check.nowMs),
          String(check.leaseMs),
          String(check.limit),
          check.owner,
          token
        ]
      )
      if (acquired !== 1) return undefined

      return {
        token,
        release: async () => {
          await client.zrem(`${keyPrefix}${check.key}`, token)
        }
      }
    }
  }
}

export function createRedisIdempotencyStore(
  client: RedisLikeClient,
  options: { keyPrefix?: string } = {}
): IdempotencyStore {
  const keyPrefix = options.keyPrefix ?? 'mcp-kit:idempotency:'
  return {
    async beginIdempotentRequest(args): Promise<IdempotencyBeginResult> {
      const token = globalThis.crypto.randomUUID()
      const result = await client.eval<
        readonly ['acquired' | 'replay' | 'in_progress', string, string]
      >(IDEMPOTENCY_BEGIN_SCRIPT, [`${keyPrefix}${args.key}`], [
        String(args.nowMs),
        String(args.ttlMs),
        args.owner,
        token
      ])
      if (result[0] === 'acquired') {
        return {
          kind: 'acquired',
          token: result[1]
        }
      }
      if (result[0] === 'replay') {
        return {
          kind: 'replay',
          result: JSON.parse(result[1]) as CallToolResult
        }
      }
      return {
        kind: 'in_progress',
        ...(result[2] === '' ? {} : { retryAfterMs: Number(result[2]) })
      }
    },
    async completeIdempotentRequest(args) {
      await client.eval<number>(
        IDEMPOTENCY_COMPLETE_SCRIPT,
        [`${keyPrefix}${args.key}`],
        [
          args.token,
          String(args.nowMs),
          String(args.ttlMs),
          JSON.stringify(args.result)
        ]
      )
    },
    async abandonIdempotentRequest(args) {
      await client.eval<number>(
        IDEMPOTENCY_ABANDON_SCRIPT,
        [`${keyPrefix}${args.key}`],
        [args.token]
      )
    }
  }
}

export const redisPolicyScripts = {
  CONCURRENCY_ACQUIRE_SCRIPT,
  IDEMPOTENCY_ABANDON_SCRIPT,
  IDEMPOTENCY_BEGIN_SCRIPT,
  IDEMPOTENCY_COMPLETE_SCRIPT,
  RATE_LIMIT_SCRIPT
} as const
