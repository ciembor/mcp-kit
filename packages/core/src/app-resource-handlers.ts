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
} from './definitions.js'
import { resourceMetadata, sdkResourceListCallback } from './runtime.js'

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
            context: createContext(extra)
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
            context: createContext(extra)
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
              context: createContext(extra)
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
