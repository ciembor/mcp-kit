import { describe, expect, it } from 'vitest'

import {
  httpSmokeSource,
  stdioServerSource,
  stdioSmokeSource,
  supportsHttpSmoke,
  supportsStdioSmoke,
  typeSmokeConfig,
  typeSmokeImportLine
} from './release-checks-smoke.js'

describe('release check smoke helpers', () => {
  it('detects when stdio and http packaged smoke tests are supported', () => {
    const core = {
      name: '@mcp-kit/core',
      version: '1.0.0',
      path: 'packages/core/package.json',
      directory: 'packages/core'
    }
    const node = {
      name: '@mcp-kit/node',
      version: '1.0.0',
      path: 'packages/node/package.json',
      directory: 'packages/node'
    }
    const testing = {
      name: '@mcp-kit/testing',
      version: '1.0.0',
      path: 'packages/testing/package.json',
      directory: 'packages/testing'
    }

    expect(supportsStdioSmoke([core, node, testing])).toBe(true)
    expect(supportsStdioSmoke([core, node])).toBe(false)
    expect(supportsHttpSmoke([core, node])).toBe(true)
    expect(supportsHttpSmoke([core, testing])).toBe(false)
  })

  it('builds stable type smoke helpers and packaged script sources', () => {
    expect(typeSmokeImportLine('@mcp-kit/core', 2)).toContain(
      'import { packageInfo as packageInfo2 } from "@mcp-kit/core"'
    )
    expect(typeSmokeImportLine('@mcp-kit/core', 2)).toContain(
      'const packageName2: string = packageInfo2.name'
    )
    expect(typeSmokeConfig()).toEqual({
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ES2022',
        strict: true,
        noEmit: true
      },
      include: ['types-smoke.ts']
    })

    expect(stdioServerSource()).toContain("name: 'health'")
    expect(stdioServerSource()).toContain('await runStdio(app)')
    expect(stdioSmokeSource('/tmp/server.mjs')).toContain(
      'connectStdioTestClient'
    )
    expect(stdioSmokeSource('/tmp/server.mjs')).toContain('"/tmp/server.mjs"')
    expect(httpSmokeSource()).toContain('runStreamableHttp')
    expect(httpSmokeSource()).toContain(
      "throw new Error('unexpected health response')"
    )
    expect(httpSmokeSource()).toContain('await runtime.close()')
  })
})
