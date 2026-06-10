import { describe, expect, it } from 'vitest'

import { isSupportedNodeVersion, nodeVersionDiagnostic } from './cli-doctor.js'

describe('cli doctor helpers', () => {
  it('accepts only supported node versions and reports unsupported ones', () => {
    expect(isSupportedNodeVersion('22.13.0')).toBe(true)
    expect(isSupportedNodeVersion('22.12.0')).toBe(false)
    expect(isSupportedNodeVersion('24.0.0')).toBe(true)
    expect(nodeVersionDiagnostic('22.12.0')).toMatchObject({
      level: 'error',
      code: 'node-version'
    })
  })
})
