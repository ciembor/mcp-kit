import type { JobQueue } from './jobs-contracts.js'
import type { RedisLikeClient } from './runtime/redis-store-client.js'

export function createRedisJobQueue(
  client: RedisLikeClient,
  options: { queueKey?: string } = {}
): JobQueue {
  const queueKey = options.queueKey ?? 'mcp-kit:jobs:queue'

  return {
    async notify(jobId: string) {
      await client.lpush(queueKey, jobId)
    },
    async wait({ signal, timeoutMs }) {
      if (signal.aborted) {
        throw abortError(signal)
      }
      const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000))
      const waiter = Promise.resolve(client.brpop(queueKey, timeoutSeconds))
      const aborted = new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(abortError(signal)), {
          once: true
        })
      })
      await Promise.race([waiter, aborted])
    }
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Queue wait aborted')
}
