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
import { unavailableToolIo } from './tool-io.js'

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
        correlationId: String(extra.requestId),
        signal: extra.signal,
        services: undefined as Services,
        logger: silentLogger,
        io: unavailableToolIo(),
        client: {
          capabilities: {},
          protocolVersion: LATEST_PROTOCOL_VERSION,
          roots: {
            supported: false,
            listChanged: false,
            list: () => Promise.resolve(undefined)
          },
          sampling: {
            supported: false,
            createMessage: () =>
              Promise.reject(
                new Error('sampling is not available in resource runtime')
              )
          },
          elicitation: {
            supported: false,
            form: false,
            url: false,
            create: () =>
              Promise.reject(
                new Error('elicitation is not available in resource runtime')
              ),
            complete: () =>
              Promise.reject(
                new Error('elicitation is not available in resource runtime')
              )
          }
        },
        sdk: extra
      }
    })
}
/* v8 ignore stop */
