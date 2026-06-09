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
  const sdk = new McpServer(
    { name: options.name, version: options.version },
    options.instructions === undefined
      ? undefined
      : { instructions: options.instructions }
  )
  const tools = new Map<string, ToolDefinition<Schema, Services>>()
  const prompts = new Map<string, PromptDefinition<Schema, Services>>()
  const resources: AnyResourceDefinition<Services>[] = []
  const subscriptions = new Set<string>()
  let connected = false
  let logger = options.logger ?? silentLogger
  let protocolVersion = LATEST_PROTOCOL_VERSION

  const createRequestContext = (
    extra: ServerRequestContext,
    signal: AbortSignal = extra.signal
  ): RequestContext<Services> => {
    const progressToken = extra._meta?.progressToken
    return {
      requestId: String(extra.requestId),
      signal,
      services: options.services,
      logger,
      client: clientContext(sdk, protocolVersion),
      ...(progressToken === undefined
        ? {}
        : { progress: { report: progressReporter(extra, progressToken) } }),
      sdk: extra
    }
  }

  const app: McpApp<Services> = {
    sdk,
    get connected() {
      return connected
    },
    tools(definitions) {
      assertNotConnected(connected)
      for (const tool of definitions) {
        tools.set(tool.name, tool)
        /* v8 ignore next 2 -- SDK registration placeholder; calls are handled by installToolCallHandler. */
        sdk.registerTool(tool.name, toolConfig(tool), () =>
          Promise.resolve({ content: [] })
        )
      }
      installToolCallHandler({
        sdk,
        tools,
        createRequestContext,
        middleware: options.middleware ?? [],
        logger: () => logger
      })
    },
    resources(definitions) {
      assertNotConnected(connected)
      const typedDefinitions =
        definitions as unknown as readonly AnyResourceDefinition<Services>[]
      resources.push(...typedDefinitions)
      registerResources(sdk, typedDefinitions, createRequestContext)
      installResourceHandlers(
        sdk,
        resources,
        subscriptions,
        createRequestContext
      )
    },
    prompts(definitions) {
      assertNotConnected(connected)
      for (const prompt of definitions) {
        prompts.set(prompt.name, prompt)
        sdk.registerPrompt(
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
      installPromptGetHandler(sdk, prompts, createRequestContext, () => logger)
    },
    async connect(transport) {
      assertNotConnected(connected)
      connected = true
      try {
        await sdk.connect(
          trackProtocolVersion(transport, (version) => {
            protocolVersion = version
          })
        )
      } catch (error) {
        connected = false
        throw error
      }
    },
    async close() {
      await sdk.close()
      connected = false
    },
    setLogger(nextLogger) {
      assertNotConnected(connected)
      logger = nextLogger
    },
    async notifyResourceListChanged() {
      await sdk.server.sendResourceListChanged()
    },
    async notifyResourceUpdated(uri) {
      if (subscriptions.has(uri)) {
        await sdk.server.sendResourceUpdated({ uri })
      }
    }
  }

  return app
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
