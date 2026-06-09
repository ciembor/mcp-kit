import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getObjectShape } from '@modelcontextprotocol/sdk/server/zod-compat.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
import type {
  ClientCapabilities,
  Implementation,
  ProgressNotificationParams
} from '@modelcontextprotocol/sdk/types.js'

import type {
  AnyResourceDefinition,
  Logger,
  PromptDefinition,
  RegistryItem,
  RequestContext,
  Schema,
  ServerRequestContext,
  ToolDefinition
} from './definitions.js'
import {
  silentLogger,
  toolConfig,
  trackProtocolVersion,
  type ToolMiddleware
} from './runtime.js'
import {
  installResourceHandlers,
  registerResources
} from './app-resource-handlers.js'
import {
  installPromptGetHandler,
  installToolCallHandler
} from './app-tool-handlers.js'

export type McpAppOptions<Services> = {
  name: string
  version: string
  services: Services
  logger?: Logger
  instructions?: string
  middleware?: readonly ToolMiddleware<Services>[]
}

export type McpApp<Services> = {
  readonly sdk: McpServer
  readonly connected: boolean
  tools(tools: readonly ToolDefinition<Schema, Services>[]): void
  resources<const Definitions extends readonly RegistryItem[]>(
    resources: Definitions
  ): void
  prompts(prompts: readonly PromptDefinition<Schema, Services>[]): void
  connect(transport: Transport): Promise<void>
  close(): Promise<void>
  setLogger(logger: Logger): void
  notifyResourceListChanged(): Promise<void>
  notifyResourceUpdated(uri: string): Promise<void>
}

export function createMcpApp<Services>(
  options: McpAppOptions<Services>
): McpApp<Services> {
  const state = createAppState(options)
  const { sdk, tools, prompts, resources, subscriptions } = state
  let connected = false
  let logger = options.logger ?? silentLogger
  let protocolVersion = LATEST_PROTOCOL_VERSION

  const createRequestContext = contextFactory(() => ({
    services: options.services,
    logger,
    sdk,
    protocolVersion
  }))
  const capabilities = capabilityMethods({
    sdk,
    tools,
    prompts,
    resources,
    subscriptions,
    createRequestContext,
    middleware: options.middleware ?? [],
    connected: () => connected,
    logger: () => logger
  })

  const lifecycle = lifecycleMethods({
    sdk,
    subscriptions,
    connected: () => connected,
    setConnected: (value) => {
      connected = value
    },
    setProtocolVersion: (value) => {
      protocolVersion = value
    }
  })
  return {
    sdk,
    get connected() {
      return connected
    },
    ...capabilities,
    ...lifecycle,
    setLogger(nextLogger) {
      assertNotConnected(connected)
      logger = nextLogger
    }
  }
}

function contextFactory<Services>(
  runtime: () => {
    services: Services
    logger: Logger
    sdk: McpServer
    protocolVersion: string
  }
): (
  extra: ServerRequestContext,
  signal?: AbortSignal
) => RequestContext<Services> {
  return (extra, signal = extra.signal) =>
    requestContext(extra, signal, runtime())
}

function createAppState<Services>(options: McpAppOptions<Services>) {
  const sdk = new McpServer(
    { name: options.name, version: options.version },
    options.instructions === undefined
      ? undefined
      : { instructions: options.instructions }
  )
  return {
    sdk,
    tools: new Map<string, ToolDefinition<Schema, Services>>(),
    prompts: new Map<string, PromptDefinition<Schema, Services>>(),
    resources: [] as AnyResourceDefinition<Services>[],
    subscriptions: new Set<string>()
  }
}

function requestContext<Services>(
  extra: ServerRequestContext,
  signal: AbortSignal,
  runtime: {
    services: Services
    logger: Logger
    sdk: McpServer
    protocolVersion: string
  }
): RequestContext<Services> {
  const progressToken = extra._meta?.progressToken
  return {
    requestId: String(extra.requestId),
    signal,
    services: runtime.services,
    logger: runtime.logger,
    client: clientContext(runtime.sdk, runtime.protocolVersion),
    ...(progressToken === undefined
      ? {}
      : { progress: { report: progressReporter(extra, progressToken) } }),
    sdk: extra
  }
}

function lifecycleMethods(runtime: {
  sdk: McpServer
  subscriptions: ReadonlySet<string>
  connected(): boolean
  setConnected(value: boolean): void
  setProtocolVersion(value: string): void
}): Pick<
  McpApp<unknown>,
  'connect' | 'close' | 'notifyResourceListChanged' | 'notifyResourceUpdated'
> {
  return {
    async connect(transport) {
      assertNotConnected(runtime.connected())
      runtime.setConnected(true)
      try {
        await runtime.sdk.connect(
          trackProtocolVersion(transport, (version) =>
            runtime.setProtocolVersion(version)
          )
        )
      } catch (error) {
        runtime.setConnected(false)
        throw error
      }
    },
    async close() {
      await runtime.sdk.close()
      runtime.setConnected(false)
    },
    async notifyResourceListChanged() {
      await runtime.sdk.server.sendResourceListChanged()
    },
    async notifyResourceUpdated(uri) {
      if (runtime.subscriptions.has(uri)) {
        await runtime.sdk.server.sendResourceUpdated({ uri })
      }
    }
  }
}

function capabilityMethods<Services>(runtime: {
  sdk: McpServer
  tools: Map<string, ToolDefinition<Schema, Services>>
  prompts: Map<string, PromptDefinition<Schema, Services>>
  resources: AnyResourceDefinition<Services>[]
  subscriptions: Set<string>
  createRequestContext(extra: ServerRequestContext): RequestContext<Services>
  middleware: readonly ToolMiddleware<Services>[]
  connected(): boolean
  logger(): Logger
}): Pick<McpApp<Services>, 'tools' | 'resources' | 'prompts'> {
  return {
    tools: (definitions) => registerTools(runtime, definitions),
    resources: (definitions) => registerAppResources(runtime, definitions),
    prompts: (definitions) => registerPrompts(runtime, definitions)
  }
}

function registerTools<Services>(
  runtime: Parameters<typeof capabilityMethods<Services>>[0],
  definitions: readonly ToolDefinition<Schema, Services>[]
): void {
  assertNotConnected(runtime.connected())
  for (const tool of definitions) {
    runtime.tools.set(tool.name, tool)
    /* v8 ignore next 2 -- SDK registration placeholder; calls are handled by installToolCallHandler. */
    runtime.sdk.registerTool(tool.name, toolConfig(tool), () =>
      Promise.resolve({ content: [] })
    )
  }
  installToolCallHandler(runtime)
}

function registerAppResources<Services>(
  runtime: Parameters<typeof capabilityMethods<Services>>[0],
  definitions: readonly RegistryItem[]
): void {
  assertNotConnected(runtime.connected())
  const resources =
    definitions as unknown as readonly AnyResourceDefinition<Services>[]
  runtime.resources.push(...resources)
  const createContext = (extra: ServerRequestContext) =>
    runtime.createRequestContext(extra)
  registerResources(runtime.sdk, resources, createContext)
  installResourceHandlers(
    runtime.sdk,
    runtime.resources,
    runtime.subscriptions,
    createContext
  )
}

function registerPrompts<Services>(
  runtime: Parameters<typeof capabilityMethods<Services>>[0],
  definitions: readonly PromptDefinition<Schema, Services>[]
): void {
  assertNotConnected(runtime.connected())
  for (const prompt of definitions) {
    runtime.prompts.set(prompt.name, prompt)
    runtime.sdk.registerPrompt(
      prompt.name,
      {
        ...(prompt.title === undefined ? {} : { title: prompt.title }),
        ...(prompt.description === undefined
          ? {}
          : { description: prompt.description }),
        argsSchema: getObjectShape(prompt.argsSchema)!
      },
      /* v8 ignore next -- SDK registration placeholder; calls are handled by installPromptGetHandler. */
      () => Promise.resolve({ messages: [] })
    )
  }
  installPromptGetHandler(
    runtime.sdk,
    runtime.prompts,
    (extra) => runtime.createRequestContext(extra),
    () => runtime.logger()
  )
}

function progressReporter(
  extra: ServerRequestContext,
  progressToken: string | number
): (
  update: Omit<ProgressNotificationParams, 'progressToken'>
) => Promise<void> {
  return async (update) =>
    extra.sendNotification({
      method: 'notifications/progress',
      params: { progressToken, ...update }
    })
}

function clientContext(
  sdk: McpServer,
  protocolVersion: string
): {
  info?: Implementation
  capabilities: ClientCapabilities
  protocolVersion: string
} {
  return {
    info: sdk.server.getClientVersion()!,
    capabilities: sdk.server.getClientCapabilities()!,
    protocolVersion
  }
}

function assertNotConnected(connected: boolean): void {
  if (connected) {
    throw new Error('Capabilities cannot be changed after transport connection')
  }
}
