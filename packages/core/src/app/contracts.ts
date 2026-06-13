import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

import type {
  AnyResourceDefinition,
  Logger,
  PromptDefinition,
  RequestContext,
  Schema,
  ServerRequestContext,
  ToolDefinition
} from '../definitions.js'
import type {
  RuntimePolicyStoreOptions,
  RuntimePolicyStores,
  ToolMiddleware
} from '../runtime.js'

export type McpAppOptions<Services> = {
  name: string
  version: string
  services: Services
  logger?: Logger
  instructions?: string
  middleware?: readonly ToolMiddleware<Services>[]
  policyStores?: RuntimePolicyStoreOptions
}

type ResourceRegistrationCheck<Definitions extends readonly unknown[]> =
  Definitions extends readonly { kind: 'resource' }[]
    ? []
    : ['resources must be resource definitions']

export type McpApp<Services> = {
  readonly sdk: McpServer
  readonly connected: boolean
  tools(tools: readonly ToolDefinition<Schema, Services>[]): void
  resources<const Definitions extends readonly unknown[]>(
    resources: Definitions,
    ...check: ResourceRegistrationCheck<Definitions>
  ): void
  prompts(prompts: readonly PromptDefinition<Schema, Services>[]): void
  connect(transport: Transport): Promise<void>
  close(): Promise<void>
  setLogger(logger: Logger): void
  notifyResourceListChanged(): Promise<void>
  notifyResourceUpdated(uri: string): Promise<void>
}

export type AppState<Services> = {
  sdk: McpServer
  tools: Map<string, ToolDefinition<Schema, Services>>
  prompts: Map<string, PromptDefinition<Schema, Services>>
  resources: AnyResourceDefinition<Services>[]
  subscriptions: Set<string>
}

export type AppRuntime<Services> = {
  sdk: McpServer
  tools: Map<string, ToolDefinition<Schema, Services>>
  prompts: Map<string, PromptDefinition<Schema, Services>>
  resources: AnyResourceDefinition<Services>[]
  subscriptions: Set<string>
  createRequestContext(extra: ServerRequestContext): RequestContext<Services>
  middleware: readonly ToolMiddleware<Services>[]
  policyStores: RuntimePolicyStores
  connected(): boolean
  logger(): Logger
}
