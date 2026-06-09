import { runStdio } from '@mcp-kit/node'
import { describe, expect, it, vi } from 'vitest'

import { startStdio } from '../../src/server/transports/stdio.js'

vi.mock('@mcp-kit/node', () => ({
  runStdio: vi.fn()
}))

describe('stdio entrypoint', () => {
  it('delegates startup to the Node adapter', async () => {
    await startStdio()
    expect(runStdio).toHaveBeenCalledOnce()
  })
})
