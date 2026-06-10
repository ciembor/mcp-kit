import type { AuthContext, McpApp } from '@mcp-kit/core'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'

export type DeploymentMode = 'development' | 'production'
export type SessionMode = 'stateless' | 'stateful'

export type StreamableHttpCorsOptions = {
  allowCredentials?: boolean
  allowedHeaders?: readonly string[]
  maxAgeSeconds?: number
}

export type StreamableHttpOptions = {
  mode?: DeploymentMode
  host?: string
  port?: number
  path?: string
  healthPath?: string | false
  readinessPath?: string | false
  sessionMode?: SessionMode
  sessionStore?: SessionStore
  auth?: false | StreamableHttpAuthOptions
  trustedProxies?: readonly string[]
  allowedHosts?: readonly string[]
  allowedOrigins?: readonly string[]
  cors?: false | StreamableHttpCorsOptions
  maxBodyBytes?: number
  requestTimeoutMs?: number
  maxConcurrency?: number
}

export type NormalizedStreamableHttpOptions = {
  mode: DeploymentMode
  host: string
  port: number
  path: string
  healthPath: string | false
  readinessPath: string | false
  sessionMode: SessionMode
  sessionStore?: SessionStore
  auth?: false | StreamableHttpAuthOptions
  trustedProxies: readonly string[]
  allowedHosts: readonly string[]
  allowedOrigins: readonly string[]
  cors: false | Required<StreamableHttpCorsOptions>
  maxBodyBytes: number
  requestTimeoutMs: number
  maxConcurrency: number
}

export type StreamableHttpRequest = {
  request: Request
  parsedBody?: unknown
}

export type StreamableHttpExchange = {
  response: Response
  close(): Promise<void>
}

export type StreamableHttpHandler = (
  request: StreamableHttpRequest
) => Promise<StreamableHttpExchange>

export type StreamableHttpRuntime = {
  readonly url: string
  readonly options: NormalizedStreamableHttpOptions
  drain(): Promise<void>
  close(): Promise<void>
}

export type McpAppFactory<Services> = () => McpApp<Services>

export type ManagedSession = {
  readonly id: string
  readonly auth: AuthContext | undefined
  handleRequest(
    request: Request,
    parsedBody?: unknown,
    auth?: AuthContext
  ): Promise<Response>
  close(): Promise<void>
}

export type SessionStore = {
  get(sessionId: string): Promise<ManagedSession | undefined>
  set(sessionId: string, session: ManagedSession): Promise<void>
  delete(sessionId: string): Promise<void>
  list(): Promise<readonly ManagedSession[]>
}

export type StreamableHttpAuthOptions = {
  verifyBearerToken(
    token: string,
    request: Request
  ): Promise<AuthContext> | AuthContext
  allowAnonymous?: boolean
  challenge?: string
  metadata?: {
    authorizationServers?: readonly string[]
    resourceName?: string
    scopesSupported?: readonly string[]
    serviceDocumentationUrl?: string
  }
}

export type StreamableHttpAuthResult = {
  auth?: AuthContext
  authInfo?: AuthInfo
  rejection?: Response
}
