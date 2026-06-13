import type { WorkspacePackageManifest } from './release-checks-manifests.js'

export function supportsStdioSmoke(
  manifests: readonly WorkspacePackageManifest[]
): boolean {
  const names = new Set(manifests.map((manifest) => manifest.name))
  return (
    names.has('@mcp-kit/core') &&
    names.has('@mcp-kit/node') &&
    names.has('@mcp-kit/testing')
  )
}

export function supportsHttpSmoke(
  manifests: readonly WorkspacePackageManifest[]
): boolean {
  const names = new Set(manifests.map((manifest) => manifest.name))
  return names.has('@mcp-kit/core') && names.has('@mcp-kit/node')
}

export function typeSmokeImportLine(specifier: string, index: number): string {
  return (
    `import { packageInfo as packageInfo${index} } from ${JSON.stringify(specifier)}\n` +
    `const packageName${index}: string = packageInfo${index}.name\n` +
    `void packageName${index}\n`
  )
}

export function typeSmokeConfig() {
  return {
    compilerOptions: {
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      target: 'ES2022',
      strict: true,
      noEmit: true
    },
    include: ['types-smoke.ts']
  }
}

export function stdioServerSource(): string {
  return `import { z } from 'zod'
import { createMcpApp, defineTool } from '@mcp-kit/core'
import { runStdio } from '@mcp-kit/node'

const health = defineTool({
  name: 'health',
  inputSchema: z.object({}),
  handler: () => ({
    content: [{ type: 'text', text: 'ok' }]
  })
})

const app = createMcpApp({
  name: 'packaged-stdio-smoke',
  version: '1.0.0',
  services: {}
})

app.tools([health])
await runStdio(app)
`
}

export function stdioSmokeSource(serverPath: string): string {
  return `import { connectStdioTestClient } from '@mcp-kit/testing'

const client = await connectStdioTestClient({
  command: process.execPath,
  args: [${JSON.stringify(serverPath)}]
})

try {
  const result = await client.client.callTool({
    name: 'health',
    arguments: {}
  })
  if (result.content?.[0]?.type !== 'text' || result.content[0].text !== 'ok') {
    throw new Error('unexpected health result')
  }
} finally {
  await client.close()
}
`
}

export function httpSmokeSource(): string {
  return `import { createMcpApp } from '@mcp-kit/core'
import { runStreamableHttp } from '@mcp-kit/node'

function createApp() {
  return createMcpApp({
    name: 'packaged-http-smoke',
    version: '1.0.0',
    services: {}
  })
}

const runtime = await runStreamableHttp(createApp, { port: 0 })

try {
  const health = await fetch(\`http://127.0.0.1:\${runtime.options.port}\${runtime.options.healthPath}\`)
  const ready = await fetch(\`http://127.0.0.1:\${runtime.options.port}\${runtime.options.readinessPath}\`)
  const healthJson = await health.json()
  const readyJson = await ready.json()
  if (!health.ok || healthJson.status !== 'ok') {
    throw new Error('unexpected health response')
  }
  if (!ready.ok || readyJson.status !== 'ready') {
    throw new Error('unexpected readiness response')
  }
} finally {
  await runtime.close()
}
`
}
