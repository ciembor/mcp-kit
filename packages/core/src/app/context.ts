import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
import type {
  ClientCapabilities,
  Implementation,
  ProgressNotificationParams,
  Root
} from '@modelcontextprotocol/sdk/types.js'

import type {
  AuthContext,
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
    ...(extra.authInfo === undefined
      ? {}
      : { auth: authContext(extra.authInfo) }),
    client: clientContext(runtime.sdk, runtime.protocolVersion),
    ...(progressToken === undefined
      ? {}
      : { progress: { report: progressReporter(extra, progressToken) } }),
    sdk: extra
  }
}

function authContext(authInfo: ServerRequestContext['authInfo']): AuthContext {
  return {
    scopes: authInfo?.scopes ?? [],
    source: authInfo === undefined ? 'anonymous' : 'oauth',
    ...(typeof authInfo?.extra?.['subject'] === 'string'
      ? { subject: authInfo.extra['subject'] }
      : {}),
    ...(typeof authInfo?.extra?.['tenantId'] === 'string'
      ? { tenantId: authInfo.extra['tenantId'] }
      : {}),
    ...(authInfo?.clientId === undefined
      ? {}
      : { clientId: authInfo.clientId }),
    ...(authInfo?.expiresAt === undefined
      ? {}
      : { expiresAt: authInfo.expiresAt }),
    ...(authInfo?.resource === undefined
      ? {}
      : { resource: authInfo.resource }),
    ...(authInfo?.token === undefined ? {} : { token: authInfo.token }),
    ...(authInfo?.extra === undefined ? {} : { extra: authInfo.extra })
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
  roots: {
    supported: boolean
    listChanged: boolean
    list(): Promise<readonly Root[] | undefined>
  }
} {
  const capabilities = sdk.server.getClientCapabilities() ?? {}
  const supportsRoots = capabilities.roots !== undefined
  return {
    info: sdk.server.getClientVersion() ?? { name: '', version: '' },
    capabilities,
    protocolVersion: protocolVersion || LATEST_PROTOCOL_VERSION,
    roots: {
      supported: supportsRoots,
      listChanged: capabilities.roots?.listChanged === true,
      async list() {
        if (!supportsRoots) return undefined
        const result = await sdk.server.listRoots()
        return result.roots
      }
    }
  }
}
