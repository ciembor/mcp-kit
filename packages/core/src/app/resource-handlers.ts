import {
  type CompleteResourceTemplateCallback,
  McpServer,
  ResourceTemplate
} from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  ErrorCode,
  ListResourcesRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  type Resource
} from '@modelcontextprotocol/sdk/types.js'

import type {
  AnyResourceDefinition,
  RequestContext,
  ServerRequestContext
} from '../definitions.js'
import {
  redactObservabilityAttributes,
  requireCapabilityAccess,
  resourceMetadata,
  sdkResourceListCallback,
  type AppObservability,
  type ObservabilityAttributes,
  type ToolObservability
} from '../runtime.js'

export function registerResources<Services>(
  sdk: McpServer,
  resources: readonly AnyResourceDefinition<Services>[],
  createContext: (extra: ServerRequestContext) => RequestContext<Services>
): void {
  for (const resource of resources) {
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
            context: createContext(extra)
          })
      )
    } else {
      sdk.registerResource(
        resource.name,
        new ResourceTemplate(resource.uriTemplate, {
          ...(resource.complete === undefined
            ? {}
            : { complete: resourceCompletionCallbacks(resource.complete) }),
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
            context: createContext(extra)
          })
      )
    }
  }
}

function resourceCompletionCallbacks(
  callbacks: Partial<Record<string, CompleteResourceTemplateCallback>>
): Record<string, CompleteResourceTemplateCallback> {
  const complete: Record<string, CompleteResourceTemplateCallback> = {}
  for (const [name, callback] of Object.entries(callbacks)) {
    if (callback !== undefined) {
      complete[name] = callback
    }
  }
  return complete
}

export function installResourceHandlers<Services>(
  sdk: McpServer,
  resources: readonly AnyResourceDefinition<Services>[],
  subscriptions: Set<string>,
  createContext: (extra: ServerRequestContext) => RequestContext<Services>,
  observability: ToolObservability | undefined
): void {
  sdk.server.setRequestHandler(ListResourcesRequestSchema, (request, extra) =>
    listResources(
      resources,
      request.params?.cursor,
      createContext(extra),
      observability
    )
  )

  sdk.server.setRequestHandler(ReadResourceRequestSchema, (request, extra) =>
    readResource(resources, request.params.uri, createContext(extra), observability)
  )

  installSubscriptionHandlers(sdk, resources, subscriptions)
}

async function listResources<Services>(
  resources: readonly AnyResourceDefinition<Services>[],
  cursor: string | undefined,
  context: RequestContext<Services>,
  observability: ToolObservability | undefined
): Promise<{ resources: Resource[]; nextCursor?: string }> {
  const attributes: ObservabilityAttributes = {
    'mcp.capability.kind': 'resource',
    'mcp.operation.name': 'list_resources',
    'mcp.request.correlation_id': context.correlationId
  }
  const span = observability?.tracer?.startSpan('mcp.resource.list', {
    kind: 'internal',
    attributes: redactObservabilityAttributes(
      observability,
      'span',
      'mcp.resource.list',
      attributes
    )
  })
  const listed: Resource[] = []
  let nextCursor: string | undefined
  try {
    for (const resource of resources) {
      const result = await listResource(resource, cursor, context)
      listed.push(...result.resources)
      nextCursor ??= result.nextCursor
    }
    await logObservedResource(observability, 'Resource list observed', attributes)
    await span?.end({ status: 'ok', attributes })
    return {
      resources: listed,
      ...(nextCursor === undefined ? {} : { nextCursor })
    }
  } catch (error) {
    await logObservedResource(observability, 'Resource list observed', {
      ...attributes,
      'mcp.outcome': 'error'
    })
    await span?.end({
      status: 'error',
      attributes: {
        ...attributes,
        'mcp.outcome': 'error'
      }
    })
    throw error
  }
}

async function listResource<Services>(
  resource: AnyResourceDefinition<Services>,
  cursor: string | undefined,
  context: RequestContext<Services>
): Promise<{ resources: Resource[]; nextCursor?: string }> {
  if (resource.uri !== undefined) {
    await requireCapabilityAccess(resource.policy, context)
    return cursor === undefined
      ? {
          resources: [
            {
              uri: resource.uri,
              name: resource.name,
              ...resourceMetadata(resource)
            }
          ]
        }
      : { resources: [] }
  }
  if (!('list' in resource) || resource.list === undefined) {
    return { resources: [] }
  }
  await requireCapabilityAccess(resource.policy, context)
  const result = await resource.list({
    ...(cursor === undefined ? {} : { cursor }),
    context
  })
  return {
    resources: result.resources,
    ...(result.nextCursor === undefined
      ? {}
      : { nextCursor: result.nextCursor })
  }
}

async function readResource<Services>(
  resources: readonly AnyResourceDefinition<Services>[],
  requestedUri: string,
  context: RequestContext<Services>,
  observability: ToolObservability | undefined
) {
  const attributes: ObservabilityAttributes = {
    'mcp.capability.kind': 'resource',
    'mcp.operation.name': 'read_resource',
    'mcp.request.correlation_id': context.correlationId,
    'mcp.resource.uri': requestedUri
  }
  const span = observability?.tracer?.startSpan('mcp.resource.read', {
    kind: 'internal',
    attributes: redactObservabilityAttributes(
      observability,
      'span',
      'mcp.resource.read',
      attributes
    )
  })
  const uri = new URL(requestedUri)
  try {
    for (const resource of resources) {
      if (resource.uri === requestedUri) {
        await requireCapabilityAccess(resource.policy, context)
        const result = await resource.read({ uri, context })
        await logObservedResource(observability, 'Resource read observed', {
          ...attributes,
          'mcp.resource.name': resource.name
        })
        await span?.end({
          status: 'ok',
          attributes: {
            ...attributes,
            'mcp.resource.name': resource.name
          }
        })
        return result
      }
      const params = templateParams(resource, requestedUri)
      if (params !== undefined) {
        await requireCapabilityAccess(resource.policy, context)
        const result = await resource.read({ uri, params, context })
        await logObservedResource(observability, 'Resource read observed', {
          ...attributes,
          'mcp.resource.name': resource.name
        })
        await span?.end({
          status: 'ok',
          attributes: {
            ...attributes,
            'mcp.resource.name': resource.name
          }
        })
        return result
      }
    }
  } catch (error) {
    await logObservedResource(observability, 'Resource read observed', {
      ...attributes,
      'mcp.outcome': 'error'
    })
    await span?.end({
      status: 'error',
      attributes: {
        ...attributes,
        'mcp.outcome': 'error'
      }
    })
    throw error
  }
  await span?.end({
    status: 'error',
    attributes: {
      ...attributes,
      'mcp.outcome': 'error'
    }
  })
  throw new McpError(
    ErrorCode.InvalidParams,
    `Resource ${requestedUri} not found`
  )
}

function templateParams<Services>(
  resource: AnyResourceDefinition<Services>,
  uri: string
): Record<string, string> | undefined {
  if (resource.uriTemplate === undefined) return undefined
  const template = new ResourceTemplate(resource.uriTemplate, {
    list: undefined
  })
  return (
    (template.uriTemplate.match(uri) as Record<string, string> | null) ??
    undefined
  )
}

function installSubscriptionHandlers<Services>(
  sdk: McpServer,
  resources: readonly AnyResourceDefinition<Services>[],
  subscriptions: Set<string>
): void {
  if (!resources.some((resource) => resource.subscriptions === true)) return
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

async function logObservedResource(
  observability: Partial<AppObservability> | undefined,
  message: string,
  attributes: ObservabilityAttributes
): Promise<void> {
  const logger = observability?.logger
  if (logger === undefined) return
  logger.info(
    message,
    redactObservabilityAttributes(observability, 'log', message, attributes)
  )
}
