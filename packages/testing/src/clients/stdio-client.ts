import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StdioClientTransport,
  type StdioServerParameters
} from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Implementation } from '@modelcontextprotocol/sdk/types.js'
import { packageInfo } from '../package-info.js'
import { ProtocolTrackingClientTransport } from '../transports/protocol-tracking-client-transport.js'

export type StdioTestClient = {
  client: Client
  transport: StdioClientTransport
  stderr: () => string
  protocolVersion: () => string | undefined
  close(): Promise<void>
}

export async function connectStdioTestClient(
  server: Omit<StdioServerParameters, 'stderr'>,
  clientInfo: Implementation = {
    name: '@mcp-kit/testing',
    version: packageInfo.version
  }
): Promise<StdioTestClient> {
  const stdioTransport = new StdioClientTransport({
    ...server,
    stderr: 'pipe'
  })
  const transport = new ProtocolTrackingClientTransport(stdioTransport)
  const client = new Client(clientInfo, { capabilities: {} })
  const stderrChunks: Buffer[] = []

  stdioTransport.stderr?.on('data', (chunk: Buffer | string) => {
    stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  })

  await client.connect(transport)

  return {
    client,
    transport: stdioTransport,
    stderr: () => Buffer.concat(stderrChunks).toString('utf8'),
    protocolVersion: () => transport.protocolVersion,
    close: () => client.close()
  }
}
