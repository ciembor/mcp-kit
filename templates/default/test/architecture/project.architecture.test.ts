import { describe, expect, it } from 'vitest'

import { analyzeProject } from '@mcp-kit/cli'

describe('project architecture', () => {
  it('keeps dependency and MCP contracts valid', async () => {
    const analysis = await analyzeProject(process.cwd())
    expect(analysis.diagnostics).toEqual([])
  })
})
