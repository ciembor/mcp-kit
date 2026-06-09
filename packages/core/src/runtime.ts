import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  LATEST_PROTOCOL_VERSION,
  type CallToolResult,
  type ListResourcesResult,
  type ToolAnnotations
} from '@modelcontextprotocol/sdk/types.js'

import type {
  AnyResourceDefinition,
  Logger,
  RequestContext,
  ResourceMetadata,
  Schema,
  ServerRequestContext,
  ToolDefinition
} from './definitions.js'
import { McpKitError } from './definitions.js'

export type ToolMiddlewareArgs<Services> = {
  tool: ToolDefinition<Schema, Services>
  input: unknown
  context: RequestContext<Services>
}

export type ToolMiddleware<Services> = (
  args: ToolMiddlewareArgs<Services>,
  next: () => Promise<CallToolResult>
) => Promise<CallToolResult>

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {}
}

export async function runToolPipeline<Services>(
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

export function toolExecutionError(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true
  }
}

export function toolConfig(tool: ToolDefinition): {
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

export function resourceMetadata(
  resource: AnyResourceDefinition
): ResourceMetadata {
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

export function timeoutAbortError(
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

export function trackProtocolVersion(
  transport: Transport,
  onProtocolVersion: (version: string) => void
): Transport {
  return new ProtocolTrackingTransport(transport, onProtocolVersion)
}

/* v8 ignore start -- SDK registration placeholder; calls are handled by app handlers. */
export function sdkResourceListCallback<Services>(
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

const activeToolCalls = new WeakMap<object, number>()

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
