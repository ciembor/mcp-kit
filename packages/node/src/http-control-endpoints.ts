import type { IncomingMessage } from 'node:http'

import type {
  StreamableHttpAuthOptions,
  StreamableHttpRuntime
} from './http-contracts.js'
import { requestUrlFromNodeRequest } from './proxy-resolution.js'
import { validateHostHeader } from './http-security.js'

export function controlEndpointResponse(
  req: IncomingMessage,
  options: StreamableHttpRuntime['options'],
  draining: boolean
): Response | undefined {
  if (req.method !== 'GET') return undefined
  const requestUrl = new URL(
    requestUrlFromNodeRequest(req, options.trustedProxies)
  )
  const request = new Request(requestUrl, {
    method: req.method,
    headers: toHeaders(req)
  })
  const hostError = validateHostHeader(request, options.allowedHosts)
  if (hostError !== undefined) return jsonErrorResponse(403, hostError)

  return (
    healthEndpointResponse(requestUrl.pathname, options.healthPath) ??
    readinessEndpointResponse(
      requestUrl.pathname,
      options.readinessPath,
      draining
    ) ??
    metadataEndpointResponse(requestUrl, options)
  )
}

function toHeaders(req: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    headers.set(key, Array.isArray(value) ? value.join(', ') : value)
  }
  return headers
}

function jsonErrorResponse(status: number, message: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message },
      id: null
    }),
    {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    }
  )
}

function healthEndpointResponse(
  pathname: string,
  healthPath: string | false
): Response | undefined {
  if (healthPath === false || pathname !== healthPath) return undefined
  return jsonStatusResponse(200, 'ok')
}

function readinessEndpointResponse(
  pathname: string,
  readinessPath: string | false,
  draining: boolean
): Response | undefined {
  if (readinessPath === false || pathname !== readinessPath) return undefined
  return jsonStatusResponse(
    draining ? 503 : 200,
    draining ? 'draining' : 'ready'
  )
}

function metadataEndpointResponse(
  requestUrl: URL,
  options: StreamableHttpRuntime['options']
): Response | undefined {
  if (
    options.auth === false ||
    options.auth === undefined ||
    options.auth.metadata === undefined ||
    requestUrl.pathname !== protectedResourceMetadataPath(options.path)
  ) {
    return undefined
  }

  return new Response(
    JSON.stringify({
      resource: canonicalResourceUrl(requestUrl, options.path).toString(),
      ...metadataBody(options.auth.metadata)
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    }
  )
}

function metadataBody(
  metadata: NonNullable<StreamableHttpAuthOptions['metadata']>
) {
  return {
    ...(metadata.authorizationServers === undefined
      ? {}
      : { authorization_servers: [...metadata.authorizationServers] }),
    ...(metadata.scopesSupported === undefined
      ? {}
      : { scopes_supported: [...metadata.scopesSupported] }),
    ...(metadata.resourceName === undefined
      ? {}
      : { resource_name: metadata.resourceName }),
    ...(metadata.serviceDocumentationUrl === undefined
      ? {}
      : { resource_documentation: metadata.serviceDocumentationUrl }),
    bearer_methods_supported: ['header']
  }
}

function jsonStatusResponse(status: number, bodyStatus: string): Response {
  return new Response(JSON.stringify({ status: bodyStatus }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
}

export function protectedResourceMetadataPath(path: string): string {
  return `/.well-known/oauth-protected-resource${path}`
}

function canonicalResourceUrl(requestUrl: URL, path: string): URL {
  const url = new URL(requestUrl.toString())
  url.pathname = path
  url.search = ''
  url.hash = ''
  return url
}
