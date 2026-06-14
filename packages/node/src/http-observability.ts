import {
  defaultObservabilityMetrics,
  redactObservabilityAttributes,
  type AppObservability,
  type ObservabilityAttributes
} from '../../core/src/index.js'

import type { NormalizedStreamableHttpOptions } from './http-contracts.js'

export function createHttpObservability(
  observability: AppObservability | undefined
) {
  const activeSessions = new Set<string>()

  return {
    startRequest(request: Request, options: NormalizedStreamableHttpOptions) {
      return startHttpRequestObservation(observability, request, options)
    },
    async sessionOpened(sessionId: string): Promise<void> {
      if (activeSessions.has(sessionId)) return
      activeSessions.add(sessionId)
      await observeActiveSessionDelta(observability, 1)
    },
    async sessionClosed(sessionId: string): Promise<void> {
      if (!activeSessions.delete(sessionId)) return
      await observeActiveSessionDelta(observability, -1)
    }
  }
}

function startHttpRequestObservation(
  observability: AppObservability | undefined,
  request: Request,
  options: NormalizedStreamableHttpOptions
): {
  end(args: { response?: Response; error?: unknown }): Promise<void>
} {
  const attributes: ObservabilityAttributes = {
    'http.method': request.method,
    'http.route': options.path,
    'url.path': new URL(request.url).pathname,
    'mcp.session.mode': options.sessionMode
  }
  const span = observability?.tracer?.startSpan('mcp.http.request', {
    kind: 'server',
    attributes: redactObservabilityAttributes(
      observability,
      'span',
      'mcp.http.request',
      attributes
    )
  })

  return {
    async end(args) {
      const statusCode = args.response?.status ?? 500
      const completed: ObservabilityAttributes = {
        ...attributes,
        'http.status_code': statusCode
      }
      await observeHttpMetric(observability, completed)
      await logHttpObservation(observability, completed)
      await span?.end({
        status:
          args.error !== undefined || statusCode >= 500 ? 'error' : 'ok',
        attributes: completed
      })
    }
  }
}

async function observeHttpMetric(
  observability: AppObservability | undefined,
  attributes: ObservabilityAttributes
): Promise<void> {
  const meter = observability?.meter
  if (meter === undefined) return
  await meter
    .counter(defaultObservabilityMetrics.httpRequestsTotal)
    .add(
      1,
      redactObservabilityAttributes(
        observability,
        'metric',
        defaultObservabilityMetrics.httpRequestsTotal,
        attributes
      )
    )
}

async function observeActiveSessionDelta(
  observability: AppObservability | undefined,
  delta: number
): Promise<void> {
  const meter = observability?.meter
  if (meter === undefined) return
  await meter
    .upDownCounter(defaultObservabilityMetrics.activeSessions)
    .add(
      delta,
      redactObservabilityAttributes(
        observability,
        'metric',
        defaultObservabilityMetrics.activeSessions,
        {
          'mcp.session.mode': 'stateful'
        }
      )
    )
}

async function logHttpObservation(
  observability: AppObservability | undefined,
  attributes: ObservabilityAttributes
): Promise<void> {
  const logger = observability?.logger
  if (logger === undefined) return
  const data = redactObservabilityAttributes(
    observability,
    'log',
    'mcp.http.request',
    attributes
  )
  const statusCode = Number(attributes['http.status_code'] ?? 500)
  if (statusCode >= 500) {
    logger.error('HTTP request observed', data)
    return
  }
  if (statusCode >= 400) {
    logger.warn('HTTP request observed', data)
    return
  }
  logger.info('HTTP request observed', data)
}
