export type RedisSetOptions = {
  nx?: boolean
  px?: number
}

export type RedisListPopResult = readonly [key: string, value: string] | null

export type RedisLikeClient = {
  del(...keys: string[]): Promise<number> | number
  eval<Result>(
    script: string,
    keys: readonly string[],
    args: readonly string[]
  ): Promise<Result> | Result
  get(key: string): Promise<string | null> | string | null
  incr(key: string): Promise<number> | number
  lpush(key: string, ...values: string[]): Promise<number> | number
  brpop(
    key: string,
    timeoutSeconds: number
  ): Promise<RedisListPopResult> | RedisListPopResult
  pexpire(key: string, ttlMs: number): Promise<number> | number
  set(
    key: string,
    value: string,
    options?: RedisSetOptions
  ): Promise<'OK' | null> | 'OK' | null
  zadd(key: string, score: number, member: string): Promise<number> | number
  zrange(
    key: string,
    start: number,
    stop: number
  ): Promise<readonly string[]> | readonly string[]
  zrangebyscore(
    key: string,
    min: number,
    max: number
  ): Promise<readonly string[]> | readonly string[]
  zrem(key: string, member: string): Promise<number> | number
  zremrangebyscore(
    key: string,
    min: number,
    max: number
  ): Promise<number> | number
}
