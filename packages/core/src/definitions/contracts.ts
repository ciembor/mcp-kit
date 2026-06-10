import type {
  AnySchema,
  SchemaOutput
} from '@modelcontextprotocol/sdk/server/zod-compat.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type {
  CallToolResult,
  ClientCapabilities,
  GetPromptResult,
  Implementation,
  ListResourcesResult,
  ProgressNotificationParams,
  ReadResourceResult,
  Resource,
  ServerNotification,
  ServerRequest,
  ToolAnnotations
} from '@modelcontextprotocol/sdk/types.js'

export const packageInfo = {
  name: '@mcp-kit/core',
  version: '0.0.0'
} as const

/** Schema contract accepted by the pinned SDK and implemented by Zod 3/4. */
export type Schema = AnySchema
export type InferSchemaOutput<TSchema extends Schema> = SchemaOutput<TSchema>

export type Logger = {
  debug(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, data?: Record<string, unknown>): void
}

export type ToolPolicy = {
  effects: 'read' | 'write'
  requiredScopes?: readonly string[]
  authorize?(
    context: RequestContext<unknown>
  ): Promise<void> | void
  timeoutMs?: number
  concurrency?: number
  audit?: boolean
}

export type CapabilityPolicy = {
  requiredScopes?: readonly string[]
  authorize?(
    context: RequestContext<unknown>
  ): Promise<void> | void
}

export type AuthContext = {
  subject?: string
  scopes: readonly string[]
  tenantId?: string
  source: 'anonymous' | 'local' | 'oauth'
  clientId?: string
  expiresAt?: number
  resource?: URL
  token?: string
  extra?: Record<string, unknown>
}

export type ServerRequestContext = RequestHandlerExtra<
  ServerRequest,
  ServerNotification
>

export type ProgressReporter = {
  report(
    update: Omit<ProgressNotificationParams, 'progressToken'>
  ): Promise<void>
}

export type RequestContext<Services> = {
  requestId: string
  signal: AbortSignal
  services: Services
  logger: Logger
  auth?: AuthContext
  client: {
    info?: Implementation
    capabilities: ClientCapabilities
    protocolVersion: string
  }
  progress?: ProgressReporter
  sdk: ServerRequestContext
}

export type ToolHandlerArgs<Input, Services> = {
  input: Input
  context: RequestContext<Services>
}

export type ToolDefinition<
  InputSchema extends Schema = Schema,
  Services = unknown
> = {
  kind: 'tool'
  name: string
  title?: string
  description?: string
  inputSchema: InputSchema
  outputSchema?: Schema
  annotations?: ToolAnnotations
  policy?: ToolPolicy
  handler(
    args: ToolHandlerArgs<InferSchemaOutput<InputSchema>, Services>
  ): Promise<CallToolResult> | CallToolResult
}

export type ToolOptions<InputSchema extends Schema, Services> = Omit<
  ToolDefinition<InputSchema, Services>,
  'kind'
>

type UriTemplateParams<Value extends string> =
  Value extends `${string}{${infer Param}}${infer Rest}`
    ? { [Key in Param | keyof UriTemplateParams<Rest>]: string }
    : Record<never, never>

export type ResourceMetadata = Omit<Resource, 'uri' | 'name'>

export type StaticResourceDefinition<Services = unknown> = {
  kind: 'resource'
  name: string
  uri: string
  uriTemplate?: never
  policy?: CapabilityPolicy
  subscriptions?: boolean
  read(args: {
    uri: URL
    context: RequestContext<Services>
  }): Promise<ReadResourceResult> | ReadResourceResult
} & ResourceMetadata

export type TemplateResourceDefinition<
  Template extends string = string,
  Services = unknown
> = {
  kind: 'resource'
  name: string
  uri?: never
  uriTemplate: Template
  policy?: CapabilityPolicy
  subscriptions?: boolean
  list?(args: {
    cursor?: string
    context: RequestContext<Services>
  }): Promise<ListResourcesResult> | ListResourcesResult
  read(args: {
    uri: URL
    params: UriTemplateParams<Template>
    context: RequestContext<Services>
  }): Promise<ReadResourceResult> | ReadResourceResult
} & ResourceMetadata

export type ResourceDefinition<Services = unknown> =
  | StaticResourceDefinition<Services>
  | TemplateResourceDefinition<string, Services>

export type AnyResourceDefinition<Services = unknown> =
  | StaticResourceDefinition<Services>
  | ({
      kind: 'resource'
      name: string
      uri?: never
      uriTemplate: string
      policy?: CapabilityPolicy
      subscriptions?: boolean
      list?(args: {
        cursor?: string
        context: RequestContext<Services>
      }): Promise<ListResourcesResult> | ListResourcesResult
      read(args: {
        uri: URL
        params: Record<string, string>
        context: RequestContext<Services>
      }): Promise<ReadResourceResult> | ReadResourceResult
    } & ResourceMetadata)

export type PromptDefinition<
  ArgsSchema extends Schema = Schema,
  Services = unknown
> = {
  kind: 'prompt'
  name: string
  title?: string
  description?: string
  argsSchema: ArgsSchema
  policy?: CapabilityPolicy
  render(args: {
    input: InferSchemaOutput<ArgsSchema>
    context: RequestContext<Services>
  }): Promise<GetPromptResult> | GetPromptResult
}

export type RegistryItem = {
  name: string
}

export type { AuthInfo }
