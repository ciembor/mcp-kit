import {
  getObjectShape,
  type AnySchema,
  type SchemaOutput
} from '@modelcontextprotocol/sdk/server/zod-compat.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
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
  timeoutMs?: number
  concurrency?: number
  audit?: boolean
}

export type CapabilityPolicy = {
  requiredScopes?: readonly string[]
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

export function defineTool<InputSchema extends Schema, Services = unknown>(
  definition: ToolOptions<InputSchema, Services>
): ToolDefinition<InputSchema, Services> {
  validateToolPolicy(definition)
  return Object.freeze({ kind: 'tool', ...definition })
}

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

export function defineResource<Services = unknown>(
  definition: Omit<StaticResourceDefinition<Services>, 'kind'>
): StaticResourceDefinition<Services>
export function defineResource<Template extends string, Services = unknown>(
  definition: Omit<TemplateResourceDefinition<Template, Services>, 'kind'>
): TemplateResourceDefinition<Template, Services>
export function defineResource(
  definition:
    | Omit<StaticResourceDefinition, 'kind'>
    | Omit<TemplateResourceDefinition, 'kind'>
): ResourceDefinition {
  if (
    ('uri' in definition && definition.uri !== undefined) ===
    ('uriTemplate' in definition && definition.uriTemplate !== undefined)
  ) {
    throw new Error(
      `Resource "${definition.name}" must define exactly one of uri or uriTemplate`
    )
  }
  return Object.freeze({ kind: 'resource', ...definition })
}

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

export function definePrompt<ArgsSchema extends Schema, Services = unknown>(
  definition: Omit<PromptDefinition<ArgsSchema, Services>, 'kind'>
): PromptDefinition<ArgsSchema, Services> {
  if (getObjectShape(definition.argsSchema) === undefined) {
    throw new Error(`Prompt "${definition.name}" argsSchema must be an object`)
  }
  return Object.freeze({ kind: 'prompt', ...definition })
}

export type RegistryItem = {
  name: string
}

export function defineRegistry<const Item extends RegistryItem>(
  items: readonly Item[]
): readonly Item[] {
  const names = new Set<string>()
  for (const item of items) {
    if (names.has(item.name)) {
      throw new Error(`Duplicate registry entry: ${item.name}`)
    }
    names.add(item.name)
  }

  return Object.freeze(
    items
      .map((item, index) => ({ item, index }))
      .sort((left, right) => {
        if (left.item.name < right.item.name) return -1
        return 1
      })
      .map(({ item }) => item)
  )
}

export class McpKitError extends Error {
  readonly code: string
  readonly safeMessage: string
  override readonly cause?: unknown

  constructor(args: {
    code: string
    message: string
    safeMessage?: string
    cause?: unknown
  }) {
    super(args.message, { cause: args.cause })
    this.name = 'McpKitError'
    this.code = args.code
    this.safeMessage = args.safeMessage ?? 'Operation failed.'
    this.cause = args.cause
  }
}

function validateToolPolicy(definition: {
  name: string
  annotations?: ToolAnnotations
  policy?: ToolPolicy
}): void {
  if (
    definition.policy?.effects === 'read' &&
    definition.annotations?.readOnlyHint === false
  ) {
    throw new Error(
      `Tool "${definition.name}" has read effects but readOnlyHint is false`
    )
  }
  if (
    definition.policy?.effects === 'write' &&
    definition.annotations?.readOnlyHint === true
  ) {
    throw new Error(
      `Tool "${definition.name}" has write effects but readOnlyHint is true`
    )
  }
}
