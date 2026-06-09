import {
  McpServer,
  ResourceTemplate
} from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  getObjectShape,
  getParseErrorMessage,
  safeParseAsync,
  type AnySchema,
  type SchemaOutput
} from '@modelcontextprotocol/sdk/server/zod-compat.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  LATEST_PROTOCOL_VERSION,
  ListResourcesRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  type CallToolResult,
  type ClientCapabilities,
  type GetPromptResult,
  type Implementation,
  type ListResourcesResult,
  type ProgressNotificationParams,
  type ReadResourceResult,
  type Resource,
  type ServerNotification,
  type ServerRequest,
  type ToolAnnotations
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

type ResourceMetadata = Omit<Resource, 'uri' | 'name'>

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

export type ToolMiddlewareArgs<Services> = {
  tool: ToolDefinition<Schema, Services>
  input: unknown
  context: RequestContext<Services>
}

export type ToolMiddleware<Services> = (
  args: ToolMiddlewareArgs<Services>,
  next: () => Promise<CallToolResult>
) => Promise<CallToolResult>

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

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {}
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
      installToolCallHandler()
    },
    resources(definitions) {
      assertNotConnected(connected)
      const typedDefinitions =
        definitions as unknown as readonly AnyResourceDefinition<Services>[]
      resources.push(...typedDefinitions)
      for (const resource of typedDefinitions) {
        const metadata = resourceMetadata(resource)
        if (resource.uri !== undefined) {
          sdk.registerResource(
            resource.name,
            resource.uri,
            metadata,
            /* v8 ignore next 5 -- SDK registration placeholder; calls are handled by installResourceHandlers. */
            async (uri, extra) =>
              resource.read({
                uri,
                context: createRequestContext(extra)
              })
          )
        } else {
          sdk.registerResource(
            resource.name,
            new ResourceTemplate(resource.uriTemplate, {
              list:
                resource.list === undefined
                  ? undefined
                  : sdkResourceListCallback(resource)
            }),
            metadata,
            /* v8 ignore next 6 -- SDK registration placeholder; calls are handled by installResourceHandlers. */
            async (uri, params, extra) =>
              resource.read({
                uri,
                params: params as Record<string, string>,
                context: createRequestContext(extra)
              })
          )
        }
      }
      installResourceHandlers()
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
      installPromptGetHandler()
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

  function createRequestContext(
    extra: ServerRequestContext,
    signal: AbortSignal = extra.signal
  ): RequestContext<Services> {
    const progressToken = extra._meta?.progressToken
    return {
      requestId: String(extra.requestId),
      signal,
      services: options.services,
      logger,
      client: {
        info: sdk.server.getClientVersion()!,
        capabilities: sdk.server.getClientCapabilities()!,
        protocolVersion
      },
      ...(progressToken === undefined
        ? {}
        : {
            progress: {
              report: async (
                update: Omit<ProgressNotificationParams, 'progressToken'>
              ) =>
                extra.sendNotification({
                  method: 'notifications/progress',
                  params: { progressToken, ...update }
                })
            }
          }),
      sdk: extra
    }
  }

  function installToolCallHandler(): void {
    sdk.server.setRequestHandler(
      CallToolRequestSchema,
      async (request, extra) => {
        const tool = tools.get(request.params.name)
        if (tool === undefined) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Tool ${request.params.name} not found`
          )
        }

        const parsed = await safeParseAsync(
          tool.inputSchema,
          request.params.arguments ?? {}
        )
        if (!parsed.success) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Invalid arguments for tool ${tool.name}: ${getParseErrorMessage(parsed.error)}`
          )
        }

        const context = createRequestContext(extra)
        const result = await runToolPipeline(
          tool,
          parsed.data,
          context,
          options.middleware ?? []
        )

        if (tool.outputSchema !== undefined) {
          if (result.structuredContent === undefined) {
            return toolExecutionError(
              'Tool returned no structuredContent required by outputSchema.'
            )
          }
          const output = await safeParseAsync(
            tool.outputSchema,
            result.structuredContent
          )
          if (!output.success) {
            const correlationId = context.requestId
            logger.error('Tool output validation failed', {
              correlationId,
              tool: tool.name
            })
            return toolExecutionError(
              `Tool output validation failed. Correlation id: ${correlationId}`
            )
          }
        }

        return result
      }
    )
  }

  function installResourceHandlers(): void {
    sdk.server.setRequestHandler(
      ListResourcesRequestSchema,
      async (request, extra) => {
        const listed: Resource[] = []
        let nextCursor: string | undefined

        for (const resource of resources) {
          if (
            resource.uri !== undefined &&
            request.params?.cursor === undefined
          ) {
            listed.push({
              uri: resource.uri,
              name: resource.name,
              ...resourceMetadata(resource)
            })
          } else if (
            resource.uriTemplate !== undefined &&
            'list' in resource &&
            resource.list
          ) {
            const result = await resource.list({
              ...(request.params?.cursor === undefined
                ? {}
                : { cursor: request.params.cursor }),
              context: createRequestContext(extra)
            })
            listed.push(...result.resources)
            nextCursor ??= result.nextCursor
          }
        }

        return {
          resources: listed,
          ...(nextCursor === undefined ? {} : { nextCursor })
        }
      }
    )

    sdk.server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request, extra) => {
        const uri = new URL(request.params.uri)
        for (const resource of resources) {
          if (resource.uri === uri.toString()) {
            return resource.read({
              uri,
              context: createRequestContext(extra)
            })
          }
          if (resource.uriTemplate !== undefined) {
            const template = new ResourceTemplate(resource.uriTemplate, {
              list: undefined
            })
            const params = template.uriTemplate.match(uri.toString())
            if (params !== null) {
              return resource.read({
                uri,
                params: params as Record<string, string>,
                context: createRequestContext(extra)
              })
            }
          }
        }
        throw new McpError(
          ErrorCode.InvalidParams,
          `Resource ${request.params.uri} not found`
        )
      }
    )

    if (resources.some((resource) => resource.subscriptions === true)) {
      sdk.server.registerCapabilities({
        resources: { subscribe: true, listChanged: true }
      })
      sdk.server.setRequestHandler(SubscribeRequestSchema, (request) => {
        subscriptions.add(request.params.uri)
        return {}
      })
      sdk.server.setRequestHandler(UnsubscribeRequestSchema, (request) => {
        subscriptions.delete(request.params.uri)
        return {}
      })
    }
  }

  function installPromptGetHandler(): void {
    sdk.server.setRequestHandler(
      GetPromptRequestSchema,
      async (request, extra) => {
        const prompt = prompts.get(request.params.name)
        if (prompt === undefined) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Prompt ${request.params.name} not found`
          )
        }

        const parsed = await safeParseAsync(
          prompt.argsSchema,
          request.params.arguments ?? {}
        )
        if (!parsed.success) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Invalid arguments for prompt ${prompt.name}: ${getParseErrorMessage(parsed.error)}`
          )
        }

        const context = createRequestContext(extra)
        try {
          return await prompt.render({
            input: parsed.data as never,
            context
          })
        } catch (error) {
          const safeMessage =
            error instanceof McpKitError
              ? error.safeMessage
              : `Operation failed. Correlation id: ${context.requestId}`
          logger.error('Prompt rendering failed', {
            correlationId: context.requestId,
            prompt: prompt.name
          })
          throw new McpError(ErrorCode.InternalError, safeMessage)
        }
      }
    )
  }
}

/* v8 ignore start -- SDK registration placeholder; calls are handled by installResourceHandlers. */
function sdkResourceListCallback<Services>(
  resource: Extract<AnyResourceDefinition<Services>, { uriTemplate: string }>
): (extra: ServerRequestContext) => Promise<ListResourcesResult> {
  return async (extra) =>
    resource.list!({
      context: {
        requestId: String(extra.requestId),
        signal: extra.signal,
        services: undefined as Services,
        logger: silentLogger,
        client: {
          capabilities: {},
          protocolVersion: LATEST_PROTOCOL_VERSION
        },
        sdk: extra
      }
    })
}
/* v8 ignore stop */

async function runToolPipeline<Services>(
  tool: ToolDefinition<Schema, Services>,
  input: unknown,
  context: RequestContext<Services>,
  middleware: readonly ToolMiddleware<Services>[]
): Promise<CallToolResult> {
  const builtIn = [
    createErrorMappingMiddleware<Services>(),
    createConcurrencyMiddleware<Services>(),
    createTimeoutMiddleware<Services>()
  ]
  const pipeline = [...builtIn, ...middleware]
  let index = -1

  const dispatch = async (position: number): Promise<CallToolResult> => {
    if (position <= index) {
      throw new Error('Tool middleware called next() more than once')
    }
    index = position
    const current = pipeline[position]
    if (current === undefined) {
      return tool.handler({ input: input as never, context })
    }
    return current({ tool, input, context }, () => dispatch(position + 1))
  }

  return dispatch(0)
}

function createErrorMappingMiddleware<Services>(): ToolMiddleware<Services> {
  return async ({ tool, context }, next) => {
    try {
      return await next()
    } catch (error) {
      if (error instanceof McpKitError) {
        context.logger.warn('Tool execution failed', {
          code: error.code,
          correlationId: context.requestId,
          tool: tool.name
        })
        return toolExecutionError(error.safeMessage)
      }

      context.logger.error('Unexpected tool execution error', {
        correlationId: context.requestId,
        tool: tool.name
      })
      return toolExecutionError(
        `Operation failed. Correlation id: ${context.requestId}`
      )
    }
  }
}

const activeToolCalls = new WeakMap<object, number>()

function createConcurrencyMiddleware<Services>(): ToolMiddleware<Services> {
  return async ({ tool }, next) => {
    const limit = tool.policy?.concurrency
    if (limit === undefined) return next()

    const active = activeToolCalls.get(tool) ?? 0
    if (active >= limit) {
      throw new McpKitError({
        code: 'CONCURRENCY_LIMIT',
        message: `Tool ${tool.name} concurrency limit exceeded`,
        safeMessage: 'The operation is busy. Try again later.'
      })
    }

    activeToolCalls.set(tool, active + 1)
    try {
      return await next()
    } finally {
      activeToolCalls.set(tool, activeToolCalls.get(tool)! - 1)
    }
  }
}

function createTimeoutMiddleware<Services>(): ToolMiddleware<Services> {
  return async ({ tool, context }, next) => {
    const timeoutMs = tool.policy?.timeoutMs
    if (timeoutMs === undefined) return next()

    const timeoutController = new AbortController()
    const timer = setTimeout(() => {
      timeoutController.abort(new Error(`Timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    const originalSignal = context.signal
    context.signal = AbortSignal.any([originalSignal, timeoutController.signal])

    try {
      return await Promise.race([
        next(),
        new Promise<never>((_resolve, reject) => {
          context.signal.addEventListener(
            'abort',
            () =>
              reject(
                timeoutAbortError(context.signal, timeoutController.signal)
              ),
            { once: true }
          )
        })
      ])
    } finally {
      clearTimeout(timer)
      context.signal = originalSignal
    }
  }
}

function timeoutAbortError(
  signal: AbortSignal,
  timeoutSignal: AbortSignal
): McpKitError {
  const timedOut = timeoutSignal.aborted
  return new McpKitError({
    code: timedOut ? 'TIMEOUT' : 'CANCELLED',
    message: String(signal.reason),
    safeMessage: timedOut
      ? 'The operation timed out.'
      : 'The operation was cancelled.'
  })
}

function toolExecutionError(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true
  }
}

function toolConfig(tool: ToolDefinition): {
  title?: string
  description?: string
  inputSchema: Schema
  outputSchema?: Schema
  annotations?: ToolAnnotations
} {
  return {
    ...(tool.title === undefined ? {} : { title: tool.title }),
    ...(tool.description === undefined
      ? {}
      : { description: tool.description }),
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema === undefined
      ? {}
      : { outputSchema: tool.outputSchema }),
    ...(tool.annotations === undefined ? {} : { annotations: tool.annotations })
  }
}

function resourceMetadata(resource: AnyResourceDefinition): ResourceMetadata {
  return {
    ...(resource.title === undefined ? {} : { title: resource.title }),
    ...(resource.description === undefined
      ? {}
      : { description: resource.description }),
    ...(resource.mimeType === undefined ? {} : { mimeType: resource.mimeType }),
    ...(resource.size === undefined ? {} : { size: resource.size }),
    ...(resource.annotations === undefined
      ? {}
      : { annotations: resource.annotations }),
    ...(resource.icons === undefined ? {} : { icons: resource.icons }),
    ...(resource._meta === undefined ? {} : { _meta: resource._meta })
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

function assertNotConnected(connected: boolean): void {
  if (connected) {
    throw new Error('Capabilities cannot be changed after transport connection')
  }
}

function trackProtocolVersion(
  transport: Transport,
  onProtocolVersion: (version: string) => void
): Transport {
  return new ProtocolTrackingTransport(transport, onProtocolVersion)
}

class ProtocolTrackingTransport implements Transport {
  onclose: NonNullable<Transport['onclose']> = () => {}
  onerror: NonNullable<Transport['onerror']> = () => {}
  onmessage: NonNullable<Transport['onmessage']> = () => {}

  constructor(
    private readonly transport: Transport,
    private readonly onProtocolVersion: (version: string) => void
  ) {}

  async start(): Promise<void> {
    this.transport.onclose = () => this.onclose()
    this.transport.onerror = (error) => this.onerror(error)
    this.transport.onmessage = (message, extra) => {
      if (
        'method' in message &&
        message.method === 'initialize' &&
        'params' in message &&
        typeof message.params === 'object' &&
        message.params !== null &&
        'protocolVersion' in message.params &&
        typeof message.params['protocolVersion'] === 'string'
      ) {
        this.onProtocolVersion(message.params['protocolVersion'])
      }
      this.onmessage(message, extra)
    }
    await this.transport.start()
  }

  send(...args: Parameters<Transport['send']>): ReturnType<Transport['send']> {
    return this.transport.send(...args)
  }

  close(): Promise<void> {
    return this.transport.close()
  }

  setProtocolVersion(version: string): void {
    this.transport.setProtocolVersion?.(version)
  }
}

export const internals = {
  silentLogger,
  timeoutAbortError,
  trackProtocolVersion
}
