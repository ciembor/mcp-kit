import type { ToolDefinition, ToolInputFieldPolicy } from '../definitions.js'
import { McpKitError, type Schema } from '../definitions.js'

import { normalizeInputError } from './tool-io-errors.js'

export function assertAllowedOutboundUrl<Services>(
  tool: ToolDefinition<Schema, Services>,
  candidate: string | URL
): URL {
  const policy = tool.policy?.outboundHttp
  if (policy !== undefined && policy.allowHosts.length > 0) {
    return assertAllowedUrl(tool.name, candidate, policy)
  }
  throw new McpKitError({
    code: 'FORBIDDEN',
    message: `Tool ${tool.name} attempted outbound HTTP without an allowlist`,
    safeMessage: 'Outbound HTTP is not allowed for this tool.'
  })
}

export function validateUrlField(
  toolName: string,
  path: string,
  policy: Extract<ToolInputFieldPolicy, { kind: 'url' }>,
  value: unknown
): void {
  if (typeof value !== 'string') return
  try {
    assertAllowedUrl(toolName, value, policy)
  } catch (error) {
    throw normalizeInputError(error, toolName, path)
  }
}

export function validateHostField(
  toolName: string,
  path: string,
  policy: Extract<ToolInputFieldPolicy, { kind: 'host' }>,
  value: unknown
): void {
  if (typeof value !== 'string') return
  try {
    assertAllowedHost(toolName, value, policy)
  } catch (error) {
    throw normalizeInputError(error, toolName, path)
  }
}

function assertAllowedUrl(
  toolName: string,
  candidate: string | URL,
  policy: {
    allowHosts: readonly string[]
    allowHttp?: boolean
    allowPrivateNetworks?: boolean
  }
): URL {
  const url =
    candidate instanceof URL
      ? new URL(candidate.toString())
      : new URL(candidate)
  assertHttpProtocol(toolName, url, policy.allowHttp)
  assertNoEmbeddedCredentials(toolName, url)
  assertPublicHostname(
    toolName,
    url.hostname,
    policy.allowPrivateNetworks,
    'Requests to private network targets are not allowed.'
  )
  assertAllowlistedHost(
    toolName,
    url.hostname,
    policy.allowHosts,
    'The outbound destination is not allowlisted.'
  )
  return url
}

function assertAllowedHost(
  toolName: string,
  candidate: string,
  policy: {
    allowHosts: readonly string[]
    allowPrivateNetworks?: boolean
  }
): string {
  const host = normalizeHostInput(candidate)
  assertPublicHostname(
    toolName,
    host,
    policy.allowPrivateNetworks,
    'Private network hosts are not allowed.'
  )
  assertAllowlistedHost(
    toolName,
    host,
    policy.allowHosts,
    'The host input is not allowlisted.'
  )
  return host
}

function assertHttpProtocol(
  toolName: string,
  url: URL,
  allowHttp: boolean | undefined
): void {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new McpKitError({
      code: 'FORBIDDEN',
      message: `Tool ${toolName} attempted unsupported outbound protocol: ${url.protocol}`,
      safeMessage: 'Only HTTP and HTTPS outbound requests are allowed.'
    })
  }
  if (url.protocol === 'http:' && allowHttp !== true) {
    throw new McpKitError({
      code: 'FORBIDDEN',
      message: `Tool ${toolName} attempted insecure outbound HTTP: ${url.toString()}`,
      safeMessage: 'HTTPS is required for outbound requests.'
    })
  }
}

function assertNoEmbeddedCredentials(toolName: string, url: URL): void {
  if (url.username === '' && url.password === '') return
  throw new McpKitError({
    code: 'FORBIDDEN',
    message: `Tool ${toolName} attempted outbound URL with embedded credentials`,
    safeMessage: 'Embedded URL credentials are not allowed.'
  })
}

function assertPublicHostname(
  toolName: string,
  hostname: string,
  allowPrivateNetworks: boolean | undefined,
  safeMessage: string
): void {
  if (allowPrivateNetworks === true || !isPrivateHostname(hostname)) return
  throw new McpKitError({
    code: 'FORBIDDEN',
    message: `Tool ${toolName} attempted private host input ${hostname}`,
    safeMessage
  })
}

function assertAllowlistedHost(
  toolName: string,
  hostname: string,
  allowHosts: readonly string[],
  safeMessage: string
): void {
  if (allowHosts.some((entry) => hostMatches(hostname, entry))) return
  throw new McpKitError({
    code: 'FORBIDDEN',
    message: `Tool ${toolName} attempted non-allowlisted host input ${hostname}`,
    safeMessage
  })
}

function normalizeHostInput(value: string): string {
  const candidate = value.trim().toLowerCase()
  if (candidate === '') {
    throw new McpKitError({
      code: 'INVALID_ARGUMENT',
      message: 'Host input must not be empty',
      safeMessage: 'Host input must not be empty.'
    })
  }
  if (!candidate.includes('://') && !candidate.includes('/')) return candidate
  throw new McpKitError({
    code: 'INVALID_ARGUMENT',
    message: `Host input must not include a scheme or path: ${value}`,
    safeMessage: 'Host input must be a hostname only.'
  })
}

function hostMatches(hostname: string, entry: string): boolean {
  const normalizedHost = hostname.toLowerCase()
  const normalizedEntry = entry.toLowerCase()
  if (!normalizedEntry.startsWith('*.'))
    return normalizedHost === normalizedEntry
  const suffix = normalizedEntry.slice(1)
  return normalizedHost.endsWith(suffix) && normalizedHost !== suffix.slice(1)
}

function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (isLoopbackHost(normalized)) return true
  const ipv4 = parseIpv4(normalized)
  if (ipv4 !== undefined) return isPrivateIpv4(ipv4)
  return normalized.includes(':') && isPrivateIpv6(normalized)
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '[::1]' || hostname === '::1'
}

function parseIpv4(hostname: string): number[] | undefined {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) return undefined
  const parts = hostname.split('.').map((part) => Number.parseInt(part, 10))
  return parts.every(
    (part) => Number.isInteger(part) && part >= 0 && part <= 255
  )
    ? parts
    : undefined
}

function isPrivateIpv4(parts: number[]): boolean {
  const [first = -1, second = -1] = parts
  return (
    isSingleOctetRange(first, 10) ||
    isSingleOctetRange(first, 127) ||
    isDoubleOctetRange([first, second], {
      first: 169,
      minSecond: 254,
      maxSecond: 254
    }) ||
    isDoubleOctetRange([first, second], {
      first: 172,
      minSecond: 16,
      maxSecond: 31
    }) ||
    isDoubleOctetRange([first, second], {
      first: 192,
      minSecond: 168,
      maxSecond: 168
    })
  )
}

function isPrivateIpv6(hostname: string): boolean {
  return (
    hostname === '::1' ||
    hostname.startsWith('fc') ||
    hostname.startsWith('fd') ||
    hostname.startsWith('fe80:')
  )
}

function isSingleOctetRange(actual: number, expected: number): boolean {
  return actual === expected
}

function isDoubleOctetRange(
  parts: readonly [number, number],
  range: {
    first: number
    minSecond: number
    maxSecond: number
  }
): boolean {
  return (
    parts[0] === range.first &&
    parts[1] >= range.minSecond &&
    parts[1] <= range.maxSecond
  )
}
