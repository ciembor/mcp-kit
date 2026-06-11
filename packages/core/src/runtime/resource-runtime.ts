import {
  LATEST_PROTOCOL_VERSION,
  type ListResourcesResult
} from '@modelcontextprotocol/sdk/types.js'

import type {
  AnyResourceDefinition,
  ResourceMetadata,
  ServerRequestContext
} from '../definitions.js'
import { silentLogger } from './tool-runtime.js'

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
          protocolVersion: LATEST_PROTOCOL_VERSION,
          roots: {
            supported: false,
            listChanged: false,
            list: () => Promise.resolve(undefined)
          }
        },
        sdk: extra
      }
    })
}
/* v8 ignore stop */
