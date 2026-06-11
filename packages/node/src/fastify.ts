import type { IncomingMessage, ServerResponse } from 'node:http'

import type {
  McpAppFactory,
  StreamableHttpOptions,
  StreamableHttpRuntime
} from './http-contracts.js'
import {
  createNodeHttpRuntime,
  protectedResourceMetadataPath
} from './http-node-runtime.js'

type FastifyRequestLike = {
  readonly raw: IncomingMessage
}

type FastifyReplyLike = {
  readonly raw: ServerResponse
}

type FastifyRouteMethod = 'DELETE' | 'GET' | 'OPTIONS' | 'POST'

type FastifyRouteOptionsLike = {
  method: FastifyRouteMethod | readonly FastifyRouteMethod[]
  url: string
  handler(
    request: FastifyRequestLike,
    reply: FastifyReplyLike
  ): Promise<void> | void
}

export type FastifyInstanceLike = {
  route(options: FastifyRouteOptionsLike): unknown
  addHook(
    name: 'onClose',
    hook: (...args: readonly unknown[]) => Promise<void> | void
  ): unknown
}

export type FastifyStreamableHttpRuntime = {
  readonly options: StreamableHttpRuntime['options']
  drain(): Promise<void>
  close(): Promise<void>
}

export function registerFastifyStreamableHttp<Services>(
  fastify: FastifyInstanceLike,
  createApp: McpAppFactory<Services>,
  options: StreamableHttpOptions = {}
): FastifyStreamableHttpRuntime {
  const runtime = createNodeHttpRuntime(createApp, options)
  const routePaths = new Set<string>([runtime.options.path])

  if (runtime.options.healthPath !== false) {
    routePaths.add(runtime.options.healthPath)
  }
  if (runtime.options.readinessPath !== false) {
    routePaths.add(runtime.options.readinessPath)
  }
  if (
    runtime.options.auth !== false &&
    runtime.options.auth !== undefined &&
    runtime.options.auth.metadata !== undefined
  ) {
    routePaths.add(protectedResourceMetadataPath(runtime.options.path))
  }

  for (const path of routePaths) {
    fastify.route({
      method: ['DELETE', 'GET', 'OPTIONS', 'POST'],
      url: path,
      handler(request, reply) {
        return runtime.handle(request.raw, reply.raw)
      }
    })
  }

  fastify.addHook('onClose', () => runtime.close())

  return {
    options: runtime.options,
    drain: () => runtime.drain(),
    close: () => runtime.close()
  }
}
