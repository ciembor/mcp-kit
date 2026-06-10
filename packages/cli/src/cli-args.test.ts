import { describe, expect, it } from 'vitest'

import { getBoolean, getEnum, getString, parseArgs } from './cli-args.js'

describe('cli args', () => {
  it('parses commands, positionals and options', () => {
    expect(parseArgs(['new', 'app', '--json', '--quality=strict'])).toEqual({
      command: 'new',
      positionals: ['app'],
      options: { json: true, quality: 'strict' }
    })
    expect(parseArgs(['--'])).toEqual({
      positionals: [],
      options: {}
    })
    expect(parseArgs([undefined as unknown as string])).toEqual({
      positionals: [],
      options: {}
    })
    expect(parseArgs(['quality', '--since', 'main', 'extra'])).toEqual({
      command: 'quality',
      positionals: ['extra'],
      options: { since: 'main' }
    })
  })

  it('reads booleans, strings and enums from parsed arguments', () => {
    const parsed = parseArgs([
      'new',
      'app',
      '--json',
      '--since',
      'main',
      '--quality',
      'strict'
    ])

    expect(getBoolean(parsed, 'json')).toBe(true)
    expect(getBoolean(parsed, 'missing')).toBe(false)
    expect(getString(parsed, 'since')).toBe('main')
    expect(getString(parsed, 'json')).toBeUndefined()
    expect(getEnum(parsed, 'quality', ['off', 'standard', 'strict'])).toBe(
      'strict'
    )
    expect(
      getEnum(parsed, 'missing', ['off', 'standard', 'strict'])
    ).toBeUndefined()
    expect(() =>
      getEnum(parseArgs(['new', 'app', '--quality']), 'quality', [
        'off',
        'standard',
        'strict'
      ])
    ).toThrow('Invalid --quality')
    expect(() =>
      getEnum(parseArgs(['new', 'app', '--quality', 'broken']), 'quality', [
        'off',
        'standard',
        'strict'
      ])
    ).toThrow('Invalid --quality')
  })
})
