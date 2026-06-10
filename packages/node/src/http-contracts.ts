import type { McpApp } from '@mcp-kit/core'

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
  sessionMode?: SessionMode
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
  sessionMode: SessionMode
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
  close(): Promise<void>
}

export type McpAppFactory<Services> = () => McpApp<Services>
