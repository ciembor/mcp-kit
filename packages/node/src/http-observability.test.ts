import { describe, expect, it } from 'vitest'

import { defaultObservabilityMetrics } from '../../core/src/index.js'
import { createHttpObservability } from './http-observability.js'

describe('http observability', () => {
  it('records request spans, metrics and logs with redaction', async () => {
    const metrics: Array<{
      name: string
      value: number
      attributes: Record<string, string | number | boolean>
    }> = []
    const logs: Array<{
      level: 'info' | 'warn' | 'error'
      message: string
      data: Record<string, unknown> | undefined
    }> = []
    const spans: Array<{
      name: string
      attributes: Record<string, string | number | boolean>
      ended?: { status?: 'ok' | 'error' }
    }> = []
    const observability = createHttpObservability({
      meter: {
        counter: (name) => ({
          add: (value, attributes) => {
            metrics.push({
              name,
              value,
              attributes: normalizeAttributes(attributes)
            })
          }
        }),
        histogram: () => ({
          record: () => undefined
        }),
        upDownCounter: (name) => ({
          add: (value, attributes) => {
            metrics.push({
              name,
              value,
              attributes: normalizeAttributes(attributes)
            })
          }
        })
      },
      tracer: {
        startSpan(name, options) {
          const record: {
            name: string
            attributes: Record<string, string | number | boolean>
            ended?: { status?: 'ok' | 'error' }
          } = {
            name,
            attributes: normalizeAttributes(options?.attributes)
          }
          spans.push(record)
          return {
            setAttributes() {},
            end(ended) {
              if (ended !== undefined) {
                record.ended =
                  ended.status === undefined
                    ? {}
                    : { status: ended.status }
              }
            }
          }
        }
      },
      logger: {
        debug() {},
        info(message, data) {
          logs.push({ level: 'info', message, data })
        },
        warn(message, data) {
          logs.push({ level: 'warn', message, data })
        },
        error(message, data) {
          logs.push({ level: 'error', message, data })
        }
      },
      redact: ({ attributes }) => ({
        ...attributes,
        ...(attributes['url.path'] === undefined
          ? {}
          : { 'url.path': '/redacted' })
      })
    })

    const request = observability.startRequest(
      new Request('http://runtime.test/mcp', { method: 'POST' }),
      {
        path: '/mcp',
        sessionMode: 'stateless'
      } as never
    )
    await request.end({
      response: new Response('ok', { status: 201 })
    })

    expect(metrics).toContainEqual({
      name: defaultObservabilityMetrics.httpRequestsTotal,
      value: 1,
      attributes: {
        'http.method': 'POST',
        'http.route': '/mcp',
        'http.status_code': 201,
        'mcp.session.mode': 'stateless',
        'url.path': '/redacted'
      }
    })
    expect(spans).toMatchObject([
      {
        name: 'mcp.http.request',
        attributes: {
          'url.path': '/redacted'
        },
        ended: { status: 'ok' }
      }
    ])
    expect(logs).toContainEqual({
      level: 'info',
      message: 'HTTP request observed',
      data: expect.objectContaining({
        'http.status_code': 201,
        'url.path': '/redacted'
      })
    })
  })

  it('tracks active sessions as an up-down counter without double counting', async () => {
    const deltas: number[] = []
    const observability = createHttpObservability({
      meter: {
        counter: () => ({
          add: () => undefined
        }),
        histogram: () => ({
          record: () => undefined
        }),
        upDownCounter: () => ({
          add: (value) => {
            deltas.push(value)
          }
        })
      }
    })

    await observability.sessionOpened('session-1')
    await observability.sessionOpened('session-1')
    await observability.sessionClosed('session-1')
    await observability.sessionClosed('session-1')

    expect(deltas).toEqual([1, -1])
  })
})

function normalizeAttributes(
  attributes: Record<string, string | number | boolean | undefined> | undefined
): Record<string, string | number | boolean> {
  const normalized: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (value !== undefined) normalized[key] = value
  }
  return normalized
}
