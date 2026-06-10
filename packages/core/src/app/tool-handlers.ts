import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  getParseErrorMessage,
  safeParseAsync
} from '@modelcontextprotocol/sdk/server/zod-compat.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  McpError
} from '@modelcontextprotocol/sdk/types.js'

import {
  McpKitError,
  type Logger,
  type PromptDefinition,
  type RequestContext,
  type Schema,
  type ServerRequestContext,
  type ToolDefinition
} from '../definitions.js'
import {
  requireCapabilityAccess,
  runToolPipeline,
  toolExecutionError,
  type ToolMiddleware
} from '../runtime.js'
import { unknownInputPaths } from '../runtime/input-validation.js'

export function installToolCallHandler<Services>(runtime: {
  sdk: McpServer
  tools: ReadonlyMap<string, ToolDefinition<Schema, Services>>
  createRequestContext(extra: ServerRequestContext): RequestContext<Services>
  middleware: readonly ToolMiddleware<Services>[]
  logger(): Logger
}): void {
  runtime.sdk.server.setRequestHandler(
    CallToolRequestSchema,
    (request, extra) => executeTool(runtime, request.params, extra)
  )
}

async function executeTool<Services>(
  runtime: {
    tools: ReadonlyMap<string, ToolDefinition<Schema, Services>>
    createRequestContext(extra: ServerRequestContext): RequestContext<Services>
    middleware: readonly ToolMiddleware<Services>[]
    logger(): Logger
  },
  params: { name: string; arguments?: Record<string, unknown> | undefined },
  extra: ServerRequestContext
) {
  const tool = runtime.tools.get(params.name)
  if (tool === undefined) {
    throw new McpError(ErrorCode.InvalidParams, `Tool ${params.name} not found`)
  }
  const parsed = await safeParseAsync(tool.inputSchema, params.arguments ?? {})
  if (!parsed.success) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid arguments for tool ${tool.name}: ${getParseErrorMessage(parsed.error)}`
    )
  }
  const unknownPaths = unknownInputPaths(params.arguments ?? {}, parsed.data)
  if (unknownPaths.length > 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid arguments for tool ${tool.name}: unknown fields ${unknownPaths.join(', ')}`
    )
  }
  const context = runtime.createRequestContext(extra)
  const result = await runToolPipeline(
    tool,
    parsed.data,
    context,
    runtime.middleware
  )
  return validateToolOutput(runtime, tool, result, context)
}

async function validateToolOutput<Services>(
  runtime: { logger(): Logger },
  tool: ToolDefinition<Schema, Services>,
  result: Awaited<ReturnType<typeof runToolPipeline<Services>>>,
  context: RequestContext<Services>
) {
  if (tool.outputSchema === undefined) return result
  if (result.structuredContent === undefined) {
    return toolExecutionError(
      'Tool returned no structuredContent required by outputSchema.'
    )
  }
  const output = await safeParseAsync(
    tool.outputSchema,
    result.structuredContent
  )
  if (output.success) return result
  runtime.logger().error('Tool output validation failed', {
    correlationId: context.requestId,
    tool: tool.name
  })
  return toolExecutionError(
    `Tool output validation failed. Correlation id: ${context.requestId}`
  )
}

export function installPromptGetHandler<Services>(
  sdk: McpServer,
  prompts: ReadonlyMap<string, PromptDefinition<Schema, Services>>,
  createContext: (extra: ServerRequestContext) => RequestContext<Services>,
  logger: () => Logger
): void {
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
      const unknownPaths = unknownInputPaths(
        request.params.arguments ?? {},
        parsed.data
      )
      if (unknownPaths.length > 0) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid arguments for prompt ${prompt.name}: unknown fields ${unknownPaths.join(', ')}`
        )
      }

      const context = createContext(extra)
      await requireCapabilityAccess(prompt.policy, context)
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
        logger().error('Prompt rendering failed', {
          correlationId: context.requestId,
          prompt: prompt.name
        })
        throw new McpError(ErrorCode.InternalError, safeMessage)
      }
    }
  )
}
