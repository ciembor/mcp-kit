import { describe, expect, it } from 'vitest'

import type { RequestContext } from '../definitions.js'
import { authorizeConsent, authorizeScopes } from './tool-runtime-shared.js'

describe('tool runtime shared helpers', () => {
  it('accepts empty scope requirements and throws for missing auth or scopes', () => {
    expect(() => authorizeScopes(makeContext(), [])).not.toThrow()
    expect(() => authorizeScopes(makeContext(), ['tools:read'])).toThrow(
      'Missing authentication context'
    )
    expect(() =>
      authorizeScopes(
        makeContext({
          auth: { source: 'oauth', scopes: [] }
        }),
        ['tools:read'],
        {
          code: 'STEP_UP_REQUIRED',
          missingMessage: (scope) => `Need ${scope}`,
          safeMessage: 'step up'
        }
      )
    ).toThrow('Need tools:read')
    expect(() =>
      authorizeScopes(
        makeContext({
          auth: { source: 'oauth', scopes: ['tools:read'] }
        }),
        ['tools:read']
      )
    ).not.toThrow()
  })

  it('validates consent scopes and accepts empty requirements', () => {
    expect(() => authorizeConsent(makeContext(), [])).not.toThrow()
    expect(() => authorizeConsent(makeContext(), ['tools:read'])).toThrow(
      'Missing consent for scopes: tools:read'
    )
    expect(() =>
      authorizeConsent(
        makeContext({
          auth: {
            source: 'oauth',
            scopes: ['tools:read'],
            authorization: {
              consent: {
                clientId: 'client-1',
                subject: 'alice',
                scopes: []
              }
            }
          }
        }),
        ['tools:read']
      )
    ).toThrow('Missing consent for scope: tools:read')
    expect(() =>
      authorizeConsent(
        makeContext({
          auth: {
            source: 'oauth',
            scopes: ['tools:read'],
            authorization: {
              consent: {
                clientId: 'client-1',
                subject: 'alice',
                scopes: ['tools:read']
              }
            }
          }
        }),
        ['tools:read']
      )
    ).not.toThrow()
  })
})

function makeContext(
  overrides: Partial<RequestContext<unknown>> = {}
): RequestContext<unknown> {
  return {
    requestId: 'req-1',
    correlationId: 'corr-1',
    signal: new AbortController().signal,
    services: {},
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {}
    },
    io: {} as RequestContext<unknown>['io'],
    client: {} as RequestContext<unknown>['client'],
    sdk: {} as RequestContext<unknown>['sdk'],
    ...overrides
  }
}
