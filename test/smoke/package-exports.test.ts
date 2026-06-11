import { packageInfo as cliPackage } from '@mcp-kit/cli'
import { packageInfo as corePackage } from '@mcp-kit/core'
import {
  createInMemoryEventStore,
  packageInfo as nodePackage
} from '@mcp-kit/node'
import { registerFastifyStreamableHttp } from '@mcp-kit/node/fastify'
import { packageInfo as testingPackage } from '@mcp-kit/testing'
import { packageInfo as createPackage } from 'create-mcp-kit'
import { describe, expect, it } from 'vitest'

describe('workspace package exports', () => {
  it('imports every package from its public root export', () => {
    expect([
      corePackage.name,
      nodePackage.name,
      testingPackage.name,
      cliPackage.name,
      createPackage.name
    ]).toEqual([
      '@mcp-kit/core',
      '@mcp-kit/node',
      '@mcp-kit/testing',
      '@mcp-kit/cli',
      'create-mcp-kit'
    ])
  })

  it('imports the Fastify adapter from the public subpath export', () => {
    expect(registerFastifyStreamableHttp).toBeTypeOf('function')
  })

  it('imports resumability helpers from the node root export', () => {
    expect(createInMemoryEventStore).toBeTypeOf('function')
  })
})
