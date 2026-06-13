import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { validateInputPolicy } from './capability-input-policy-validation.js'
import { validateToolPolicy } from './capability-policy-validation.js'

describe('tool policy validation branches', () => {
  it('validates detailed input policy constraints', () => {
    expect(() => validateInputPolicy('tool', { fields: {} })).toThrow(
      'Tool "tool" policy.input.fields must not be empty'
    )
    expect(() =>
      validateInputPolicy('tool', { fields: { ' ': { kind: 'string' } } })
    ).toThrow('Tool "tool" policy.input field path must not be empty')
    expect(() =>
      validateInputPolicy('tool', {
        fields: {
          name: { kind: 'string', minLength: -1 }
        }
      })
    ).toThrow('Tool "tool" name.minLength must be a non-negative integer')
    expect(() =>
      validateInputPolicy('tool', {
        fields: {
          name: { kind: 'string', minLength: 3, maxLength: 2 }
        }
      })
    ).toThrow(
      'Tool "tool" policy.input field "name" minLength must not exceed maxLength'
    )
    expect(() =>
      validateInputPolicy('tool', {
        fields: {
          count: { kind: 'number', min: 5, max: 4 }
        }
      })
    ).toThrow('Tool "tool" policy.input field "count" min must not exceed max')
    expect(() =>
      validateInputPolicy('tool', {
        fields: {
          tags: { kind: 'collection', maxItems: -1 }
        }
      })
    ).toThrow('Tool "tool" tags.maxItems must be a non-negative integer')
    expect(() =>
      validateInputPolicy('tool', {
        fields: {
          url: { kind: 'url', allowHosts: [] }
        }
      })
    ).toThrow(
      'Tool "tool" policy.input.fields.url.allowHosts must not be empty'
    )
    expect(() =>
      validateInputPolicy('tool', {
        fields: {
          path: { kind: 'filesystemPath' }
        }
      })
    ).toThrow(
      'Tool "tool" policy.input field "path" filesystemPath requires roots or clientRoots'
    )

    expect(() =>
      validateInputPolicy('tool', {
        fields: {
          path: { kind: 'filesystemPath', clientRoots: 'require' },
          host: { kind: 'host', allowHosts: ['api.example.com'] }
        }
      })
    ).not.toThrow()
    expect(() =>
      validateInputPolicy('tool', {
        fields: {
          url: { kind: 'url' } as never
        }
      })
    ).not.toThrow()
    expect(() =>
      validateInputPolicy('tool', {
        fields: {
          url: { kind: 'url', allowHosts: ['api.example.com'] }
        }
      })
    ).not.toThrow()
  })

  it('validates tool policy invariants and error paths', () => {
    expect(() =>
      validateToolPolicy({
        name: 'no-policy'
      })
    ).not.toThrow()
    expect(() =>
      validateToolPolicy({
        name: 'read-mismatch',
        annotations: { readOnlyHint: false },
        policy: { effects: 'read' }
      })
    ).toThrow('Tool "read-mismatch" has read effects but readOnlyHint is false')
    expect(() =>
      validateToolPolicy({
        name: 'write-mismatch',
        annotations: { readOnlyHint: true },
        policy: { effects: 'write' }
      })
    ).toThrow(
      'Tool "write-mismatch" has write effects but readOnlyHint is true'
    )
    expect(() =>
      validateToolPolicy({
        name: 'missing-destructive-policy',
        annotations: { destructiveHint: true },
        policy: { effects: 'write' }
      })
    ).toThrow(
      'Tool "missing-destructive-policy" declares destructiveHint but is missing policy.destructive'
    )
    expect(() =>
      validateToolPolicy({
        name: 'destructive-needs-write',
        annotations: { destructiveHint: true },
        policy: { effects: 'read', destructive: {} }
      })
    ).toThrow(
      'Tool "destructive-needs-write" destructive policy requires write effects'
    )
    expect(() =>
      validateToolPolicy({
        name: 'destructive-needs-hint',
        policy: { effects: 'write', destructive: {} }
      })
    ).toThrow(
      'Tool "destructive-needs-hint" destructive policy requires destructiveHint: true'
    )
    expect(() =>
      validateToolPolicy({
        name: 'bad-output-page-size',
        policy: {
          effects: 'read',
          output: { defaultPageSize: 3, maxPageSize: 2 }
        }
      })
    ).toThrow(
      'Tool "bad-output-page-size" output.defaultPageSize must not exceed output.maxPageSize'
    )
    expect(() =>
      validateToolPolicy({
        name: 'outbound-needs-output-schema',
        policy: {
          effects: 'read',
          outboundHttp: { allowHosts: ['api.example.com'] }
        }
      })
    ).toThrow(
      'Tool "outbound-needs-output-schema" outboundHttp policy requires outputSchema'
    )
    expect(() =>
      validateToolPolicy({
        name: 'empty-outbound-allowlist',
        outputSchema: z.object({}),
        policy: {
          effects: 'read',
          outboundHttp: { allowHosts: [] }
        }
      })
    ).toThrow(
      'Tool "empty-outbound-allowlist" policy.outboundHttp.allowHosts must not be empty'
    )
    expect(() =>
      validateToolPolicy({
        name: 'bad-timeout',
        policy: { effects: 'read', timeoutMs: 0 }
      })
    ).toThrow('Tool "bad-timeout" policy.timeoutMs must be a positive integer')
    expect(() =>
      validateToolPolicy({
        name: 'bad-concurrency',
        policy: { effects: 'read', concurrency: 0 }
      })
    ).toThrow(
      'Tool "bad-concurrency" policy.concurrency must be a positive integer'
    )
    expect(() =>
      validateToolPolicy({
        name: 'bad-rate-window',
        policy: {
          effects: 'read',
          rateLimit: { windowMs: 0, maxCalls: 1 }
        }
      })
    ).toThrow(
      'Tool "bad-rate-window" policy.rateLimit.windowMs must be a positive integer'
    )
    expect(() =>
      validateToolPolicy({
        name: 'bad-rate-max',
        policy: {
          effects: 'read',
          rateLimit: { windowMs: 1, maxCalls: 0 }
        }
      })
    ).toThrow(
      'Tool "bad-rate-max" policy.rateLimit.maxCalls must be a positive integer'
    )
    expect(() =>
      validateToolPolicy({
        name: 'read-idempotency',
        policy: { effects: 'read', idempotency: true }
      })
    ).toThrow(
      'Tool "read-idempotency" idempotency policy requires write effects'
    )
    expect(() =>
      validateToolPolicy({
        name: 'empty-idempotency-field',
        policy: { effects: 'write', idempotency: { keyField: ' ' } }
      })
    ).toThrow(
      'Tool "empty-idempotency-field" policy.idempotency.keyField must not be empty'
    )

    expect(() =>
      validateToolPolicy({
        name: 'valid',
        outputSchema: z.object({}),
        annotations: { readOnlyHint: false, destructiveHint: true },
        policy: {
          effects: 'write',
          destructive: {},
          input: {
            fields: {
              url: { kind: 'url', allowHosts: ['api.example.com'] }
            }
          },
          outboundHttp: { allowHosts: ['api.example.com'] },
          idempotency: true,
          timeoutMs: 1,
          concurrency: 1,
          rateLimit: { windowMs: 1, maxCalls: 1 }
        }
      })
    ).not.toThrow()
  })
})
