import {
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
  requireCapabilityAccess,
  resourceMetadata,
  sdkResourceListCallback
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

export function installResourceHandlers<Services>(
  sdk: McpServer,
  resources: readonly AnyResourceDefinition<Services>[],
  subscriptions: Set<string>,
  createContext: (extra: ServerRequestContext) => RequestContext<Services>
): void {
  sdk.server.setRequestHandler(ListResourcesRequestSchema, (request, extra) =>
    listResources(resources, request.params?.cursor, createContext(extra))
  )

  sdk.server.setRequestHandler(ReadResourceRequestSchema, (request, extra) =>
    readResource(resources, request.params.uri, createContext(extra))
  )

  installSubscriptionHandlers(sdk, resources, subscriptions)
}

async function listResources<Services>(
  resources: readonly AnyResourceDefinition<Services>[],
  cursor: string | undefined,
  context: RequestContext<Services>
): Promise<{ resources: Resource[]; nextCursor?: string }> {
  const listed: Resource[] = []
  let nextCursor: string | undefined
  for (const resource of resources) {
    const result = await listResource(resource, cursor, context)
    listed.push(...result.resources)
    nextCursor ??= result.nextCursor
  }
  return {
    resources: listed,
    ...(nextCursor === undefined ? {} : { nextCursor })
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
  context: RequestContext<Services>
) {
  const uri = new URL(requestedUri)
  for (const resource of resources) {
    if (resource.uri === requestedUri) {
      await requireCapabilityAccess(resource.policy, context)
      return resource.read({ uri, context })
    }
    const params = templateParams(resource, requestedUri)
    if (params !== undefined) {
      await requireCapabilityAccess(resource.policy, context)
      return resource.read({ uri, params, context })
    }
  }
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
