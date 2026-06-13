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
  type InferSchemaOutput,
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
  type RuntimePolicyStores,
  type ToolMiddleware
} from '../runtime.js'
import { validateToolInputPolicies } from '../runtime/tool-io.js'
import { unknownInputPaths } from '../runtime/input-validation.js'

export function installToolCallHandler<Services>(runtime: {
  sdk: McpServer
  tools: ReadonlyMap<string, ToolDefinition<Schema, Services>>
  createRequestContext(extra: ServerRequestContext): RequestContext<Services>
  middleware: readonly ToolMiddleware<Services>[]
  policyStores: RuntimePolicyStores
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
    policyStores: RuntimePolicyStores
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
  await validateToolInput(tool, parsed.data, context)
  const result = await runToolPipeline(
    tool,
    parsed.data,
    context,
    runtime.middleware,
    runtime.policyStores
  )
  return validateToolOutput(runtime, tool, result, context)
}

async function validateToolInput<Services>(
  tool: ToolDefinition<Schema, Services>,
  input: unknown,
  context: RequestContext<Services>
): Promise<void> {
  try {
    await validateToolInputPolicies(tool, input, context)
  } catch (error) {
    const message =
      error instanceof McpKitError ? error.safeMessage : 'Input is not allowed.'
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid arguments for tool ${tool.name}: ${message}`
    )
  }
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
    correlationId: context.correlationId,
    tool: tool.name
  })
  return toolExecutionError(
    `Tool output validation failed. Correlation id: ${context.correlationId}`
  )
}

export function installPromptGetHandler<Services>(
  sdk: McpServer,
  prompts: ReadonlyMap<string, PromptDefinition<Schema, Services>>,
  createContext: (extra: ServerRequestContext) => RequestContext<Services>,
  logger: () => Logger
): void {
  const runtime = { prompts, createContext, logger }
  sdk.server.setRequestHandler(GetPromptRequestSchema, (request, extra) =>
    executePrompt(runtime, request.params, extra)
  )
}

async function executePrompt<ArgsSchema extends Schema, Services>(
  runtime: {
    prompts: ReadonlyMap<string, PromptDefinition<ArgsSchema, Services>>
    createContext(extra: ServerRequestContext): RequestContext<Services>
    logger(): Logger
  },
  params: { name: string; arguments?: Record<string, unknown> | undefined },
  extra: ServerRequestContext
) {
  const prompt = requirePrompt(runtime.prompts, params.name)
  const parsed = await parsePromptArguments(prompt, params.arguments ?? {})
  const context = runtime.createContext(extra)
  await requireCapabilityAccess(prompt.policy, context)

  try {
    return await prompt.render({ input: parsed, context })
  } catch (error) {
    runtime.logger().error('Prompt rendering failed', {
      correlationId: context.correlationId,
      prompt: prompt.name
    })
    throw new McpError(
      ErrorCode.InternalError,
      error instanceof McpKitError
        ? error.safeMessage
        : `Operation failed. Correlation id: ${context.correlationId}`
    )
  }
}

function requirePrompt<ArgsSchema extends Schema, Services>(
  prompts: ReadonlyMap<string, PromptDefinition<ArgsSchema, Services>>,
  name: string
): PromptDefinition<ArgsSchema, Services> {
  const prompt = prompts.get(name)
  if (prompt !== undefined) return prompt
  throw new McpError(ErrorCode.InvalidParams, `Prompt ${name} not found`)
}

async function parsePromptArguments<ArgsSchema extends Schema, Services>(
  prompt: PromptDefinition<ArgsSchema, Services>,
  input: Record<string, unknown>
): Promise<InferSchemaOutput<ArgsSchema>> {
  const parsed = await safeParseAsync(prompt.argsSchema, input)
  if (!parsed.success) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid arguments for prompt ${prompt.name}: ${getParseErrorMessage(parsed.error)}`
    )
  }
  const unknownPaths = unknownInputPaths(input, parsed.data)
  if (unknownPaths.length === 0) return parsed.data
  throw new McpError(
    ErrorCode.InvalidParams,
    `Invalid arguments for prompt ${prompt.name}: unknown fields ${unknownPaths.join(', ')}`
  )
}
