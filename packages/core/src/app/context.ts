import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
import type {
  ClientCapabilities,
  Implementation,
  ProgressNotificationParams
} from '@modelcontextprotocol/sdk/types.js'

import type {
  Logger,
  RequestContext,
  ServerRequestContext
} from '../definitions.js'

export function contextFactory<Services>(
  runtime: () => {
    services: Services
    logger: Logger
    sdk: McpServer
    protocolVersion: string
  }
): (
  extra: ServerRequestContext,
  signal?: AbortSignal
) => RequestContext<Services> {
  return (extra, signal = extra.signal) =>
    requestContext(extra, signal, runtime())
}

export function requestContext<Services>(
  extra: ServerRequestContext,
  signal: AbortSignal,
  runtime: {
    services: Services
    logger: Logger
    sdk: McpServer
    protocolVersion: string
  }
): RequestContext<Services> {
  const progressToken = extra._meta?.progressToken
  return {
    requestId: String(extra.requestId),
    signal,
    services: runtime.services,
    logger: runtime.logger,
    client: clientContext(runtime.sdk, runtime.protocolVersion),
    ...(progressToken === undefined
      ? {}
      : { progress: { report: progressReporter(extra, progressToken) } }),
    sdk: extra
  }
}

export function progressReporter(
  extra: ServerRequestContext,
  progressToken: string | number
): (
  update: Omit<ProgressNotificationParams, 'progressToken'>
) => Promise<void> {
  return async (update) =>
    extra.sendNotification({
      method: 'notifications/progress',
      params: { progressToken, ...update }
    })
}

export function clientContext(
  sdk: McpServer,
  protocolVersion: string
): {
  info?: Implementation
  capabilities: ClientCapabilities
  protocolVersion: string
} {
  return {
    info: sdk.server.getClientVersion() ?? { name: '', version: '' },
    capabilities: sdk.server.getClientCapabilities() ?? {},
    protocolVersion: protocolVersion || LATEST_PROTOCOL_VERSION
  }
}
