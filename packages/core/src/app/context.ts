import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
import type {
  ClientCapabilities,
  CreateMessageRequest,
  CreateMessageResult,
  CreateMessageResultWithTools,
  ElicitRequestFormParams,
  ElicitRequestURLParams,
  ElicitResult,
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
import {
  assertElicitationSupport,
  elicitationSupport,
  unsupportedCapability
} from './context-elicitation.js'

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
  const correlationId = requestCorrelationId(extra)
  return {
    requestId: String(extra.requestId),
    correlationId,
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

function requestCorrelationId(extra: ServerRequestContext): string {
  const header = extra.requestInfo?.headers['x-mcp-kit-correlation-id']
  if (typeof header === 'string' && header.length > 0) {
    return header
  }
  if (Array.isArray(header) && header[0] !== undefined && header[0] !== '') {
    return header[0]
  }
  return `mcp-${globalThis.crypto.randomUUID()}`
}

function authContext(authInfo: ServerRequestContext['authInfo']): AuthContext {
  const authorization = authInfo?.extra?.['authorization']
  return {
    scopes: authInfo?.scopes ?? [],
    source: authSource(),
    ...authExtraField(authInfo, 'subject', 'subject'),
    ...authExtraField(authInfo, 'tenantId', 'tenantId'),
    ...optionalAuthField('clientId', authInfo?.clientId),
    ...optionalAuthField('expiresAt', authInfo?.expiresAt),
    ...optionalAuthField('resource', authInfo?.resource),
    ...(isAuthorizationDetails(authorization) ? { authorization } : {}),
    ...optionalAuthField('extra', authInfo?.extra)
  }
}

function progressReporter(
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

function clientContext(
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
  sampling: {
    supported: boolean
    createMessage(
      params: CreateMessageRequest['params']
    ): Promise<CreateMessageResult | CreateMessageResultWithTools>
  }
  elicitation: {
    supported: boolean
    form: boolean
    url: boolean
    create(
      params: ElicitRequestFormParams | ElicitRequestURLParams
    ): Promise<ElicitResult>
    complete(elicitationId: string): Promise<void>
  }
} {
  const capabilities = sdk.server.getClientCapabilities() ?? {}
  const supportsRoots = capabilities.roots !== undefined
  const supportsSampling = capabilities.sampling !== undefined
  const {
    supportsElicitation,
    supportsFormElicitation,
    supportsUrlElicitation
  } = elicitationSupport(capabilities)
  return {
    info: sdk.server.getClientVersion() ?? { name: '', version: '' },
    capabilities,
    protocolVersion: protocolVersion || LATEST_PROTOCOL_VERSION,
    roots: rootsContext(sdk, supportsRoots, capabilities),
    sampling: samplingContext(sdk, supportsSampling),
    elicitation: elicitationContext(
      sdk,
      supportsElicitation,
      supportsFormElicitation,
      supportsUrlElicitation
    )
  }
}

function authExtraField(
  authInfo: ServerRequestContext['authInfo'],
  key: string,
  field: 'subject' | 'tenantId'
): Partial<Pick<AuthContext, 'subject' | 'tenantId'>> {
  const value = authInfo?.extra?.[key]
  return typeof value === 'string' ? { [field]: value } : {}
}

function optionalAuthField<Key extends keyof AuthContext>(
  key: Key,
  value: AuthContext[Key] | undefined
): Partial<Pick<AuthContext, Key>> {
  return value === undefined ? {} : ({ [key]: value } as Pick<AuthContext, Key>)
}

function rootsContext(
  sdk: McpServer,
  supportsRoots: boolean,
  capabilities: ClientCapabilities
) {
  return {
    supported: supportsRoots,
    listChanged: capabilities.roots?.listChanged === true,
    async list() {
      if (!supportsRoots) return undefined
      const result = await sdk.server.listRoots()
      return result.roots
    }
  }
}

function samplingContext(sdk: McpServer, supportsSampling: boolean) {
  return {
    supported: supportsSampling,
    async createMessage(params: CreateMessageRequest['params']) {
      if (!supportsSampling) {
        throw unsupportedCapability(
          'Client does not support sampling/createMessage',
          'Client does not support sampling requests.'
        )
      }
      return sdk.server.createMessage(params)
    }
  }
}

function elicitationContext(
  sdk: McpServer,
  supportsElicitation: boolean,
  supportsFormElicitation: boolean,
  supportsUrlElicitation: boolean
) {
  return {
    supported: supportsElicitation,
    form: supportsFormElicitation,
    url: supportsUrlElicitation,
    async create(params: ElicitRequestFormParams | ElicitRequestURLParams) {
      assertElicitationSupport(
        params,
        supportsElicitation,
        supportsFormElicitation,
        supportsUrlElicitation
      )
      return sdk.server.elicitInput(params)
    },
    async complete(elicitationId: string) {
      if (!supportsElicitation) {
        throw unsupportedCapability(
          'Client does not support notifications/elicitation/complete',
          'Client does not support elicitation requests.'
        )
      }
      await sdk.server.createElicitationCompletionNotifier(elicitationId)()
    }
  }
}

function authSource(): AuthContext['source'] {
  return 'oauth'
}

function isAuthorizationDetails(
  value: unknown
): value is NonNullable<AuthContext['authorization']> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  return true
}
