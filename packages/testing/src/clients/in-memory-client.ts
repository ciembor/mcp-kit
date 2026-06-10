import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Implementation } from '@modelcontextprotocol/sdk/types.js'
import type { McpApp } from '@mcp-kit/core'
import { packageInfo } from '../package-info.js'

export type McpTestClient = {
  client: Client
  close(): Promise<void>
}

type TestClientOptions = {
  clientInfo?: Implementation
  clientOptions?: ConstructorParameters<typeof Client>[1]
}

export async function createMcpTestClient<Services>(
  app: McpApp<Services>,
  options: TestClientOptions = {}
): Promise<McpTestClient> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  const client = new Client(
    options.clientInfo ?? {
      name: '@mcp-kit/testing',
      version: packageInfo.version
    },
    options.clientOptions ?? { capabilities: {} }
  )

  await Promise.all([
    app.connect(serverTransport),
    client.connect(clientTransport)
  ])

  return {
    client,
    close: () => client.close()
  }
}

export async function createInMemoryMcpTestClient<Services>(
  app: McpApp<Services>,
  options: TestClientOptions = {}
): Promise<McpTestClient> {
  return createMcpTestClient(app, options)
}
