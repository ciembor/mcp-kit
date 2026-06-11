import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it } from 'vitest'

type PackageManifest = {
  version?: string
  engines?: {
    node?: string
  }
  dependencies?: {
    '@modelcontextprotocol/sdk'?: string
  }
}

const root = resolve(import.meta.dirname, '..')

describe('compatibility matrix', () => {
  it('matches the pinned SDK, protocol, and supported Node matrix', async () => {
    const rootPackage = await readPackageManifest(resolve(root, 'package.json'))
    const corePackage = await readPackageManifest(
      resolve(root, 'packages/core/package.json')
    )
    const compatibility = await readFile(
      resolve(root, 'docs/compatibility.md'),
      'utf8'
    )

    expect(compatibility).toContain(
      `| ${displayVersionSeries(rootPackage.version)}   | ${corePackage.dependencies?.['@modelcontextprotocol/sdk']}             | ${LATEST_PROTOCOL_VERSION}            | 22.13+, 24.x | Initial development |`
    )
    expect(rootPackage.engines?.node).toBe('^22.13.0 || ^24.0.0')
    expect(corePackage.engines?.node).toBe('^22.13.0 || ^24.0.0')
  })
})

async function readPackageManifest(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as PackageManifest
}

function displayVersionSeries(version: string | undefined): string {
  if (version === undefined) return '0.0.x'
  const [major = '0', minor = '0'] = version.split('.')
  return `${major}.${minor}.x`
}
