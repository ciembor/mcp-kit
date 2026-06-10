import { describe, expect, it } from 'vitest'

import {
  asJsonObject,
  errorMessage,
  isJsonObject,
  isNodeErrorCode,
  sha256,
  toCamelName,
  toKebabName,
  toPackageName
} from './cli-utils.js'

describe('cli utils', () => {
  it('normalizes names for package, kebab and camel casing', () => {
    expect(toKebabName('Hello World')).toBe('hello-world')
    expect(toKebabName('---Server---')).toBe('server')
    expect(toCamelName('hello-world')).toBe('helloWorld')
    expect(toPackageName('---Server---')).toBe('server')
    expect(() => toPackageName('!!!')).toThrow('Cannot derive a package name')
  })

  it('handles json and node error helpers', () => {
    expect(isJsonObject({ ok: true })).toBe(true)
    expect(isJsonObject([])).toBe(false)
    expect(asJsonObject({ ok: true })).toEqual({ ok: true })
    expect(asJsonObject(undefined)).toEqual({})
    expect(
      isNodeErrorCode(
        Object.assign(new Error('missing'), { code: 'ENOENT' }),
        'ENOENT'
      )
    ).toBe(true)
    expect(isNodeErrorCode(new Error('missing'), 'ENOENT')).toBe(false)
  })

  it('formats error messages and hashes consistently', () => {
    expect(errorMessage(new Error('typed'))).toBe('typed')
    expect(errorMessage('raw')).toBe('raw')
    expect(sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })
})
