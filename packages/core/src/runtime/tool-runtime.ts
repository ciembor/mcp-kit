import type {
  CallToolResult,
  ToolAnnotations
} from '@modelcontextprotocol/sdk/types.js'

import type {
  CapabilityPolicy,
  Logger,
  RequestContext,
  Schema,
  ToolDefinition
} from '../definitions.js'
import { McpKitError } from '../definitions.js'
import {
  createAuditMiddleware,
  createAuthorizationMiddleware,
  createConcurrencyMiddleware,
  createInMemoryRuntimePolicyStores,
  createDestructiveMiddleware,
  createIdempotencyMiddleware,
  createObservabilityMiddleware,
  createRateLimitMiddleware,
  createResultLimitMiddleware,
  createTimeoutMiddleware
} from './tool-runtime-policy.js'
export { createInMemoryRuntimePolicyStores } from './tool-runtime-policy.js'
export type {
  AuditEvent,
  AuditStore,
  ConcurrencyCheck,
  ConcurrencyPermit,
  ConcurrencyStore,
  IdempotencyStore,
  RateLimitCheck,
  RateLimitDecision,
  RateLimitStore,
  RuntimePolicyStoreOptions,
  RuntimePolicyStores
} from './tool-runtime-policy.js'
export type {
  ToolExecutionEvent,
  ToolExecutionOutcome,
  ToolMiddleware,
  ToolMiddlewareArgs,
  ToolMiddlewarePhases,
  ToolObservability
} from './tool-runtime-shared.js'
export { timeoutAbortError } from './tool-runtime-shared.js'
import {
  authorizeConsent,
  authorizeScopes,
  type ToolMiddleware,
  type ToolMiddlewarePhases,
  type ToolObservability
} from './tool-runtime-shared.js'
import { bindToolIo } from './tool-io.js'
import type { RuntimePolicyStores } from './tool-runtime-policy.js'

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {}
}

const defaultRuntimePolicyStores = createInMemoryRuntimePolicyStores()

export async function runToolPipeline<Services>(
  tool: ToolDefinition<Schema, Services>,
  input: unknown,
  context: RequestContext<Services>,
  middleware: readonly ToolMiddleware<Services>[],
  policyStores: RuntimePolicyStores = defaultRuntimePolicyStores,
  middlewarePhases: ToolMiddlewarePhases<Services> = {},
  observability?: ToolObservability
): Promise<CallToolResult> {
  const builtIn = [
    createErrorMappingMiddleware<Services>(),
    createObservabilityMiddleware<Services>(observability),
    ...(middlewarePhases.onError ?? []),
    ...(middlewarePhases.beforePolicy ?? []),
    createAuditMiddleware<Services>(policyStores.audit),
    createAuthorizationMiddleware<Services>(),
    createRateLimitMiddleware<Services>(policyStores.rateLimit),
    createConcurrencyMiddleware<Services>(policyStores.concurrency),
    createTimeoutMiddleware<Services>(),
    createToolIoMiddleware<Services>(),
    createDestructiveMiddleware<Services>(),
    createIdempotencyMiddleware<Services>(policyStores.idempotency),
    ...(middlewarePhases.afterResult ?? []),
    createResultLimitMiddleware<Services>(),
    ...(middlewarePhases.aroundHandler ?? [])
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

function createToolIoMiddleware<Services>(): ToolMiddleware<Services> {
  return async ({ tool, context }, next) => {
    const originalIo = context.io
    context.io = bindToolIo(tool, context)
    try {
      return await next()
    } finally {
      context.io = originalIo
    }
  }
}

export function toolExecutionError(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true
  }
}

export async function requireCapabilityAccess(
  policy: CapabilityPolicy | undefined,
  context: RequestContext<unknown>
): Promise<void> {
  await policy?.authorize?.(context)
  requireScopes(policy, context)
  requireStepUp(policy, context)
  requireConsent(policy, context)
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

function createErrorMappingMiddleware<Services>(): ToolMiddleware<Services> {
  return async ({ tool, context }, next) => {
    try {
      return await next()
    } catch (error) {
      if (error instanceof McpKitError) {
        context.logger.warn('Tool execution failed', {
          code: error.code,
          correlationId: context.correlationId,
          tool: tool.name
        })
        return toolExecutionError(error.safeMessage)
      }

      context.logger.error('Unexpected tool execution error', {
        correlationId: context.correlationId,
        tool: tool.name
      })
      return toolExecutionError(
        `Operation failed. Correlation id: ${context.correlationId}`
      )
    }
  }
}

function requireScopes(
  policy: CapabilityPolicy | undefined,
  context: RequestContext<unknown>
): void {
  if (policy?.requiredScopes !== undefined) {
    authorizeScopes(context, policy.requiredScopes)
  }
}

function requireStepUp(
  policy: CapabilityPolicy | undefined,
  context: RequestContext<unknown>
): void {
  if (policy?.stepUpScopes === undefined) return
  authorizeScopes(context, policy.stepUpScopes, {
    code: 'STEP_UP_REQUIRED',
    missingMessage: (scope) =>
      `Step-up authorization required for scope: ${scope}`,
    safeMessage: 'Additional authorization is required.'
  })
}

function requireConsent(
  policy: CapabilityPolicy | undefined,
  context: RequestContext<unknown>
): void {
  if (policy?.requiredConsentScopes !== undefined) {
    authorizeConsent(context, policy.requiredConsentScopes)
  }
}
