import { afterEach, describe, expect, it } from 'vitest'

import { exitCodes } from './index.js'
import { main } from './bin.js'

afterEach(() => {
  process.exitCode = undefined
})

describe('mcp-kit bin', () => {
  it('delegates to runCli and stores the process exit code', async () => {
    await main(['help'])

    expect(process.exitCode).toBe(exitCodes.ok)
  })
})
