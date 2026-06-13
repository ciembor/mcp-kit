import type {
  AnySchema,
  SchemaOutput
} from '@modelcontextprotocol/sdk/server/zod-compat.js'
import type { CompleteResourceTemplateCallback } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type {
  CallToolResult,
  ClientCapabilities,
  GetPromptResult,
  Implementation,
  ListResourcesResult,
  ReadResourceResult,
  Resource,
  ServerNotification,
  ServerRequest,
  ToolAnnotations
} from '@modelcontextprotocol/sdk/types.js'
import type {
  AuthContext,
  AuthorizationConsent,
  AuthorizationDetails,
  AuthorizationStepUp
} from './contracts-auth.js'
import type {
  ClientElicitation,
  ClientRoots,
  ClientSampling,
  ProgressReporter
} from './contracts-client.js'

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
  stepUpScopes?: readonly string[]
  requiredConsentScopes?: readonly string[]
  input?: ToolInputPolicy
  filesystem?: ToolFilesystemPolicy
  outboundHttp?: ToolOutboundHttpPolicy
  output?: ToolOutputPolicy
  destructive?: ToolDestructivePolicy
  authorize?(context: RequestContext<unknown>): Promise<void> | void
  rateLimit?: {
    windowMs: number
    maxCalls: number
  }
  timeoutMs?: number
  concurrency?: number
  audit?: boolean
}

export type CapabilityPolicy = {
  requiredScopes?: readonly string[]
  stepUpScopes?: readonly string[]
  requiredConsentScopes?: readonly string[]
  authorize?(context: RequestContext<unknown>): Promise<void> | void
}

export type {
  AuthContext,
  AuthorizationConsent,
  AuthorizationDetails,
  AuthorizationStepUp
}

export type ServerRequestContext = RequestHandlerExtra<
  ServerRequest,
  ServerNotification
>

export type { ClientElicitation, ClientRoots, ClientSampling, ProgressReporter }

export type ToolFilesystemPolicy = {
  roots?: readonly (string | URL)[]
  clientRoots?: boolean | 'require'
}

export type ToolInputFieldPolicy =
  | {
      kind: 'string'
      minLength?: number
      maxLength?: number
    }
  | {
      kind: 'number'
      min?: number
      max?: number
      integer?: boolean
    }
  | {
      kind: 'collection'
      minItems?: number
      maxItems?: number
    }
  | ({
      kind: 'url'
    } & ToolOutboundHttpPolicy)
  | {
      kind: 'host'
      allowHosts: readonly string[]
      allowPrivateNetworks?: boolean
    }
  | {
      kind: 'filesystemPath'
      roots?: readonly (string | URL)[]
      clientRoots?: boolean | 'require'
      allowAbsolute?: boolean
    }

export type ToolInputPolicy = {
  fields: Readonly<Record<string, ToolInputFieldPolicy>>
}

export type ToolOutboundHttpPolicy = {
  allowHosts: readonly string[]
  allowHttp?: boolean
  allowPrivateNetworks?: boolean
}

export type ToolOutputPolicy = {
  maxContentItems?: number
  maxTextChars?: number
  maxStructuredBytes?: number
  maxBlobBytes?: number
  defaultPageSize?: number
  maxPageSize?: number
}

export type ToolDestructivePolicy = {
  requireConfirmation?:
    | boolean
    | {
        field: string
        value?: string | number | boolean
      }
}

export type PaginatedResult<T> = {
  items: readonly T[]
  limit: number
  nextCursor?: string
  total: number
}

export type ToolIo = {
  files: {
    resolvePath(candidate: string | URL): Promise<string>
    roots(): Promise<readonly URL[]>
  }
  http: {
    assertAllowed(url: string | URL): URL
  }
  results: {
    paginate<T>(options: {
      items: readonly T[]
      limit?: number
      cursor?: string
      encodeCursor?(offset: number): string
      decodeCursor?(cursor: string): number
    }): PaginatedResult<T>
  }
  destructive: {
    assertConfirmation(input: unknown): void
  }
}

export type RequestContext<Services> = {
  requestId: string
  correlationId: string
  signal: AbortSignal
  services: Services
  logger: Logger
  io: ToolIo
  auth?: AuthContext
  client: {
    info?: Implementation
    capabilities: ClientCapabilities
    protocolVersion: string
    roots: ClientRoots
    sampling: ClientSampling
    elicitation: ClientElicitation
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
  complete?: Partial<
    Record<
      keyof UriTemplateParams<Template> & string,
      CompleteResourceTemplateCallback
    >
  >
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
      complete?: Partial<Record<string, CompleteResourceTemplateCallback>>
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
