import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StdioClientTransport,
  type StdioServerParameters
} from '@modelcontextprotocol/sdk/client/stdio.js'
import type {
  Implementation,
  JSONRPCMessage
} from '@modelcontextprotocol/sdk/types.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type {
  AnyResourceDefinition,
  McpApp,
  PromptDefinition,
  Schema,
  ToolDefinition
} from '@mcp-kit/core'

export const packageInfo = {
  name: '@mcp-kit/testing',
  version: '0.0.0'
} as const

export type StdioTestClient = {
  client: Client
  transport: StdioClientTransport
  stderr: () => string
  protocolVersion: () => string | undefined
  close(): Promise<void>
}

export type McpTestClient = {
  client: Client
  close(): Promise<void>
}

export async function createMcpTestClient<Services>(
  app: McpApp<Services>,
  options: {
    clientInfo?: Implementation
    clientOptions?: ConstructorParameters<typeof Client>[1]
  } = {}
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
  options: {
    clientInfo?: Implementation
    clientOptions?: ConstructorParameters<typeof Client>[1]
  } = {}
): Promise<McpTestClient> {
  return createMcpTestClient(app, options)
}

export function assertToolContracts(
  tools: readonly ToolDefinition<Schema, unknown>[]
): void {
  assertRegistryContracts('tool', tools)
  for (const tool of tools) {
    if (tool.inputSchema === undefined) {
      throw new Error(`Tool "${tool.name}" has no input schema`)
    }
    if (
      tool.policy?.effects === 'write' &&
      tool.annotations?.readOnlyHint !== false
    ) {
      throw new Error(
        `Mutating tool "${tool.name}" must set readOnlyHint to false`
      )
    }
  }
}

export function assertResourceContracts(
  resources: readonly { name: string }[]
): void {
  assertRegistryContracts('resource', resources)
  for (const resource of resources as readonly AnyResourceDefinition<unknown>[]) {
    const candidate = resource as {
      name: string
      uri?: string
      uriTemplate?: string
    }
    if (candidate.uri === undefined && candidate.uriTemplate === undefined) {
      throw new Error(`Resource "${candidate.name}" has no URI`)
    }
  }
}

export function assertPromptContracts(
  prompts: readonly PromptDefinition<Schema, unknown>[]
): void {
  assertRegistryContracts('prompt', prompts)
  for (const prompt of prompts) {
    if (prompt.argsSchema === undefined) {
      throw new Error(`Prompt "${prompt.name}" has no args schema`)
    }
  }
}

function assertRegistryContracts(
  kind: string,
  definitions: readonly { name: string }[]
): void {
  const names = definitions.map(({ name }) => name)
  if (names.some((name) => name.length === 0)) {
    throw new Error(`${kind} name cannot be empty`)
  }
  if (new Set(names).size !== names.length) {
    throw new Error(`Duplicate ${kind} name`)
  }
  const sorted = [...names].sort((left, right) => (left < right ? -1 : 1))
  if (names.some((name, index) => name !== sorted[index])) {
    throw new Error(`${kind} registry is not sorted`)
  }
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

class ProtocolTrackingClientTransport implements Transport {
  onclose: NonNullable<Transport['onclose']> = () => {}
  onerror: NonNullable<Transport['onerror']> = () => {}
  onmessage: NonNullable<Transport['onmessage']> = () => {}
  protocolVersion: string | undefined

  constructor(private readonly transport: StdioClientTransport) {}

  async start(): Promise<void> {
    this.transport.onclose = () => this.onclose()
    this.transport.onerror = (error) => this.onerror(error)
    this.transport.onmessage = (message: JSONRPCMessage) => {
      if (
        'result' in message &&
        typeof message.result === 'object' &&
        message.result !== null &&
        'protocolVersion' in message.result &&
        typeof message.result['protocolVersion'] === 'string'
      ) {
        this.protocolVersion = message.result['protocolVersion']
      }
      this.onmessage(message)
    }
    await this.transport.start()
  }

  send(message: JSONRPCMessage): Promise<void> {
    return this.transport.send(message)
  }

  close(): Promise<void> {
    return this.transport.close()
  }
}
