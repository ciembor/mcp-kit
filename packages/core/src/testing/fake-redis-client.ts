import type {
  RedisLikeClient,
  RedisListPopResult,
  RedisSetOptions
} from '../runtime/redis-store-client.js'
import { redisPolicyScripts } from '../runtime/redis-policy-stores.js'

type SortedSetEntry = {
  member: string
  score: number
}

type IdempotencyState =
  | {
      status: 'in_progress'
      owner: string
      token: string
      expiresAt: number
    }
  | {
      status: 'completed'
      result: string
      expiresAt: number
    }

export class FakeRedisClient implements RedisLikeClient {
  readonly #strings = new Map<string, string>()
  readonly #expirations = new Map<string, number>()
  readonly #sortedSets = new Map<string, SortedSetEntry[]>()
  readonly #lists = new Map<string, string[]>()

  del(...keys: string[]): number {
    let deleted = 0
    for (const key of keys) {
      if (this.#strings.delete(key)) deleted += 1
      this.#expirations.delete(key)
      if (this.#sortedSets.delete(key)) deleted += 1
      if (this.#lists.delete(key)) deleted += 1
    }
    return deleted
  }

  eval<Result>(
    script: string,
    keys: readonly string[],
    args: readonly string[]
  ): Result {
    if (script === redisPolicyScripts.RATE_LIMIT_SCRIPT) {
      return this.#evalRateLimit(keys[0] ?? '', args) as Result
    }
    if (script === redisPolicyScripts.CONCURRENCY_ACQUIRE_SCRIPT) {
      return this.#evalConcurrencyAcquire(keys[0] ?? '', args) as Result
    }
    if (script === redisPolicyScripts.IDEMPOTENCY_BEGIN_SCRIPT) {
      return this.#evalIdempotencyBegin(keys[0] ?? '', args) as Result
    }
    if (script === redisPolicyScripts.IDEMPOTENCY_COMPLETE_SCRIPT) {
      return this.#evalIdempotencyComplete(keys[0] ?? '', args) as Result
    }
    if (script === redisPolicyScripts.IDEMPOTENCY_ABANDON_SCRIPT) {
      return this.#evalIdempotencyAbandon(keys[0] ?? '', args) as Result
    }
    throw new Error(`Unsupported Redis script: ${script}`)
  }

  get(key: string): string | null {
    this.#expireKeyIfNeeded(key)
    return this.#strings.get(key) ?? null
  }

  incr(key: string): number {
    this.#expireKeyIfNeeded(key)
    const next = Number(this.#strings.get(key) ?? '0') + 1
    this.#strings.set(key, String(next))
    return next
  }

  lpush(key: string, ...values: string[]): number {
    const queue = this.#lists.get(key) ?? []
    queue.unshift(...values)
    this.#lists.set(key, queue)
    return queue.length
  }

  async brpop(
    key: string,
    timeoutSeconds: number
  ): Promise<RedisListPopResult> {
    const deadline = Date.now() + timeoutSeconds * 1000
    while (Date.now() < deadline) {
      const queue = this.#lists.get(key) ?? []
      const value = queue.pop()
      if (value !== undefined) return [key, value]
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    return null
  }

  pexpire(key: string, ttlMs: number): number {
    this.#expirations.set(key, Date.now() + ttlMs)
    return 1
  }

  set(key: string, value: string, options: RedisSetOptions = {}): 'OK' | null {
    this.#expireKeyIfNeeded(key)
    if (options.nx === true && this.#strings.has(key)) {
      return null
    }
    this.#strings.set(key, value)
    if (options.px !== undefined) {
      this.#expirations.set(key, Date.now() + options.px)
    }
    return 'OK'
  }

  zadd(key: string, score: number, member: string): number {
    const entries = this.#sortedSets.get(key) ?? []
    const existing = entries.find((entry) => entry.member === member)
    if (existing !== undefined) {
      existing.score = score
    } else {
      entries.push({ member, score })
    }
    entries.sort((left, right) => left.score - right.score)
    this.#sortedSets.set(key, entries)
    return 1
  }

  zrange(key: string, start: number, stop: number): readonly string[] {
    const entries = this.#sortedSets.get(key) ?? []
    const normalizedStop = stop === -1 ? entries.length : stop + 1
    return entries.slice(start, normalizedStop).map((entry) => entry.member)
  }

  zrangebyscore(key: string, min: number, max: number): readonly string[] {
    return (this.#sortedSets.get(key) ?? [])
      .filter((entry) => entry.score >= min && entry.score <= max)
      .map((entry) => entry.member)
  }

  zrem(key: string, member: string): number {
    const entries = this.#sortedSets.get(key) ?? []
    const next = entries.filter((entry) => entry.member !== member)
    this.#sortedSets.set(key, next)
    return entries.length === next.length ? 0 : 1
  }

  zremrangebyscore(key: string, min: number, max: number): number {
    const entries = this.#sortedSets.get(key) ?? []
    const next = entries.filter(
      (entry) => entry.score < min || entry.score > max
    )
    this.#sortedSets.set(key, next)
    return entries.length - next.length
  }

  #expireKeyIfNeeded(key: string): void {
    const expiration = this.#expirations.get(key)
    if (expiration === undefined || expiration > Date.now()) return
    this.#expirations.delete(key)
    this.#strings.delete(key)
    this.#sortedSets.delete(key)
    this.#lists.delete(key)
  }

  #evalRateLimit(
    key: string,
    args: readonly string[]
  ): readonly [number, number] {
    const nowMs = Number(args[0] ?? '0')
    const windowMs = Number(args[1] ?? '0')
    const maxCalls = Number(args[2] ?? '0')
    this.#expireKeyIfNeeded(key)
    const current = this.#strings.get(key)
    if (current === undefined) {
      this.#strings.set(key, '1')
      this.#expirations.set(key, nowMs + windowMs)
      return [1, 0]
    }
    const count = Number(current)
    const resetAt = this.#expirations.get(key) ?? nowMs
    if (count >= maxCalls) {
      return [0, Math.max(0, resetAt - nowMs)]
    }
    this.#strings.set(key, String(count + 1))
    return [1, 0]
  }

  #evalConcurrencyAcquire(key: string, args: readonly string[]): number {
    const nowMs = Number(args[0] ?? '0')
    const leaseMs = Number(args[1] ?? '0')
    const limit = Number(args[2] ?? '0')
    const token = args[4] ?? ''
    this.zremrangebyscore(key, Number.NEGATIVE_INFINITY, nowMs)
    const active = this.#sortedSets.get(key) ?? []
    if (active.length >= limit) return 0
    this.zadd(key, nowMs + leaseMs, token)
    return 1
  }

  #evalIdempotencyBegin(
    key: string,
    args: readonly string[]
  ): readonly ['acquired' | 'replay' | 'in_progress', string, string] {
    const nowMs = Number(args[0] ?? '0')
    const ttlMs = Number(args[1] ?? '0')
    const owner = args[2] ?? ''
    const token = args[3] ?? ''
    this.#expireKeyIfNeeded(key)
    const entry = this.#strings.get(key)
    if (entry === undefined) {
      const next: IdempotencyState = {
        status: 'in_progress',
        owner,
        token,
        expiresAt: nowMs + ttlMs
      }
      this.#strings.set(key, JSON.stringify(next))
      this.#expirations.set(key, next.expiresAt)
      return ['acquired', token, '']
    }
    const parsed = JSON.parse(entry) as IdempotencyState
    if (parsed.status === 'completed') {
      return ['replay', parsed.result, '']
    }
    return ['in_progress', '', String(Math.max(0, parsed.expiresAt - nowMs))]
  }

  #evalIdempotencyComplete(key: string, args: readonly string[]): number {
    const token = args[0] ?? ''
    const nowMs = Number(args[1] ?? '0')
    const ttlMs = Number(args[2] ?? '0')
    const result = args[3] ?? ''
    this.#expireKeyIfNeeded(key)
    const entry = this.#strings.get(key)
    if (entry === undefined) return 0
    const parsed = JSON.parse(entry) as IdempotencyState
    if (parsed.status !== 'in_progress' || parsed.token !== token) return 0
    const completed: IdempotencyState = {
      status: 'completed',
      result,
      expiresAt: nowMs + ttlMs
    }
    this.#strings.set(key, JSON.stringify(completed))
    this.#expirations.set(key, completed.expiresAt)
    return 1
  }

  #evalIdempotencyAbandon(key: string, args: readonly string[]): number {
    const token = args[0] ?? ''
    this.#expireKeyIfNeeded(key)
    const entry = this.#strings.get(key)
    if (entry === undefined) return 0
    const parsed = JSON.parse(entry) as IdempotencyState
    if (parsed.status !== 'in_progress' || parsed.token !== token) return 0
    this.#strings.delete(key)
    this.#expirations.delete(key)
    return 1
  }
}
