import { access, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type {
  PaginatedResult,
  RequestContext,
  Schema,
  ToolDefinition,
  ToolIo,
  ToolOutputPolicy
} from '../definitions.js'
import { McpKitError } from '../definitions.js'

export function unavailableToolIo(): ToolIo {
  return {
    files: {
      resolvePath() {
        return Promise.reject(unavailableToolIoError())
      },
      roots() {
        return Promise.resolve([])
      }
    },
    http: {
      assertAllowed() {
        throw unavailableToolIoError()
      }
    },
    results: {
      paginate<T>({
        items,
        limit,
        cursor,
        encodeCursor,
        decodeCursor
      }: {
        items: readonly T[]
        limit?: number
        cursor?: string
        encodeCursor?: (offset: number) => string
        decodeCursor?: (cursor: string) => number
      }): PaginatedResult<T> {
        return paginateItems(
          items,
          {},
          paginationOptions({
            limit,
            cursor,
            encodeCursor,
            decodeCursor
          })
        )
      }
    },
    destructive: {
      assertConfirmation() {
        throw unavailableToolIoError()
      }
    }
  }
}

export function bindToolIo<Services>(
  tool: ToolDefinition<Schema, Services>,
  context: RequestContext<Services>
): ToolIo {
  return {
    files: {
      resolvePath: (candidate) => resolveToolPath(tool, context, candidate),
      roots: () => toolFilesystemRoots(tool, context)
    },
    http: {
      assertAllowed: (url) => assertAllowedOutboundUrl(tool, url)
    },
    results: {
      paginate: <T>({
        items,
        limit,
        cursor,
        encodeCursor,
        decodeCursor
      }: {
        items: readonly T[]
        limit?: number
        cursor?: string
        encodeCursor?: (offset: number) => string
        decodeCursor?: (cursor: string) => number
      }) =>
        paginateItems(
          items,
          tool.policy?.output,
          paginationOptions({
            limit,
            cursor,
            encodeCursor,
            decodeCursor
          })
        )
    },
    destructive: {
      assertConfirmation: (input) => assertDestructiveConfirmation(tool, input)
    }
  }
}

export function validateToolResultLimits<Services>(
  tool: ToolDefinition<Schema, Services>,
  result: Awaited<ReturnType<ToolDefinition<Schema, Services>['handler']>>
): void {
  const output = tool.policy?.output
  if (output === undefined) return

  if (
    output.maxContentItems !== undefined &&
    result.content.length > output.maxContentItems
  ) {
    throw new McpKitError({
      code: 'OUTPUT_LIMIT',
      message: `Tool ${tool.name} returned ${result.content.length} content items, exceeding the limit of ${output.maxContentItems}`,
      safeMessage: 'The operation returned too much data.'
    })
  }

  for (const item of result.content) {
    if (
      output.maxTextChars !== undefined &&
      'text' in item &&
      typeof item.text === 'string' &&
      item.text.length > output.maxTextChars
    ) {
      throw new McpKitError({
        code: 'OUTPUT_LIMIT',
        message: `Tool ${tool.name} returned text exceeding ${output.maxTextChars} characters`,
        safeMessage: 'The operation returned too much data.'
      })
    }

    if (
      output.maxBlobBytes !== undefined &&
      'data' in item &&
      typeof item.data === 'string' &&
      decodedByteLength(item.data) > output.maxBlobBytes
    ) {
      throw new McpKitError({
        code: 'OUTPUT_LIMIT',
        message: `Tool ${tool.name} returned blob data exceeding ${output.maxBlobBytes} bytes`,
        safeMessage: 'The operation returned too much data.'
      })
    }
  }

  if (
    output.maxStructuredBytes !== undefined &&
    result.structuredContent !== undefined &&
    Buffer.byteLength(JSON.stringify(result.structuredContent), 'utf8') >
      output.maxStructuredBytes
  ) {
    throw new McpKitError({
      code: 'OUTPUT_LIMIT',
      message: `Tool ${tool.name} returned structured content exceeding ${output.maxStructuredBytes} bytes`,
      safeMessage: 'The operation returned too much data.'
    })
  }
}

export function assertDestructiveConfirmation<Services>(
  tool: ToolDefinition<Schema, Services>,
  input: unknown
): void {
  const destructive = tool.policy?.destructive
  if (destructive === undefined) return
  const confirmation = destructive.requireConfirmation
  if (confirmation === false) return

  const record = isRecord(input) ? input : undefined
  const field =
    typeof confirmation === 'object' ? confirmation.field : 'confirm'
  const expected =
    typeof confirmation === 'object' ? (confirmation.value ?? true) : true
  if (record?.[field] === expected) return

  throw new McpKitError({
    code: 'FORBIDDEN',
    message: `Tool ${tool.name} requires destructive confirmation via input field "${field}"`,
    safeMessage: 'This operation requires explicit confirmation.'
  })
}

function unavailableToolIoError(): McpKitError {
  return new McpKitError({
    code: 'POLICY',
    message:
      'Tool I/O helpers are only available while executing a tool handler',
    safeMessage: 'The operation is not available in this context.'
  })
}

async function resolveToolPath<Services>(
  tool: ToolDefinition<Schema, Services>,
  context: RequestContext<Services>,
  candidate: string | URL
): Promise<string> {
  const roots = await toolFilesystemRoots(tool, context)
  if (roots.length === 0) {
    throw new McpKitError({
      code: 'FORBIDDEN',
      message: `Tool ${tool.name} attempted filesystem access without configured roots`,
      safeMessage: 'Filesystem access is not allowed for this tool.'
    })
  }

  const absoluteCandidate = normalizePathCandidate(candidate)
  const ancestor = await nearestExistingAncestor(absoluteCandidate)
  const realAncestor = await realpath(ancestor)

  for (const root of roots) {
    const rootPath = normalizePathCandidate(root)
    if (!isWithin(rootPath, absoluteCandidate)) continue

    const realRoot = await realpath(rootPath).catch(() => rootPath)
    if (isWithin(realRoot, realAncestor)) {
      return absoluteCandidate
    }
  }

  throw new McpKitError({
    code: 'FORBIDDEN',
    message: `Tool ${tool.name} attempted filesystem access outside configured roots: ${absoluteCandidate}`,
    safeMessage: 'Filesystem access is outside the configured roots.'
  })
}

async function toolFilesystemRoots<Services>(
  tool: ToolDefinition<Schema, Services>,
  context: RequestContext<Services>
): Promise<readonly URL[]> {
  const configured = tool.policy?.filesystem
  const roots = [...(configured?.roots ?? [])].map(asFileUrl)
  const wantsClientRoots =
    configured?.clientRoots === true || configured?.clientRoots === 'require'

  if (!wantsClientRoots) return roots

  if (!context.client.roots.supported) {
    if (configured?.clientRoots === 'require') {
      throw new McpKitError({
        code: 'FORBIDDEN',
        message: `Tool ${tool.name} requires client roots but the client does not expose them`,
        safeMessage: 'Client filesystem roots are required.'
      })
    }
    return roots
  }

  const clientRoots = await context.client.roots.list()
  const fileRoots = (clientRoots ?? [])
    .map((root) => {
      try {
        return new URL(root.uri)
      } catch {
        return undefined
      }
    })
    .filter((root): root is URL => root?.protocol === 'file:')

  if (configured?.clientRoots === 'require' && fileRoots.length === 0) {
    throw new McpKitError({
      code: 'FORBIDDEN',
      message: `Tool ${tool.name} requires at least one client file root`,
      safeMessage: 'Client filesystem roots are required.'
    })
  }

  return [...roots, ...fileRoots]
}

function assertAllowedOutboundUrl<Services>(
  tool: ToolDefinition<Schema, Services>,
  candidate: string | URL
): URL {
  const policy = tool.policy?.outboundHttp
  if (policy === undefined || policy.allowHosts.length === 0) {
    throw new McpKitError({
      code: 'FORBIDDEN',
      message: `Tool ${tool.name} attempted outbound HTTP without an allowlist`,
      safeMessage: 'Outbound HTTP is not allowed for this tool.'
    })
  }

  const url =
    candidate instanceof URL
      ? new URL(candidate.toString())
      : new URL(candidate)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new McpKitError({
      code: 'FORBIDDEN',
      message: `Tool ${tool.name} attempted unsupported outbound protocol: ${url.protocol}`,
      safeMessage: 'Only HTTP and HTTPS outbound requests are allowed.'
    })
  }
  if (url.protocol === 'http:' && policy.allowHttp !== true) {
    throw new McpKitError({
      code: 'FORBIDDEN',
      message: `Tool ${tool.name} attempted insecure outbound HTTP: ${url.toString()}`,
      safeMessage: 'HTTPS is required for outbound requests.'
    })
  }
  if (url.username !== '' || url.password !== '') {
    throw new McpKitError({
      code: 'FORBIDDEN',
      message: `Tool ${tool.name} attempted outbound URL with embedded credentials`,
      safeMessage: 'Embedded URL credentials are not allowed.'
    })
  }
  if (policy.allowPrivateNetworks !== true && isPrivateHostname(url.hostname)) {
    throw new McpKitError({
      code: 'FORBIDDEN',
      message: `Tool ${tool.name} attempted outbound request to private host ${url.hostname}`,
      safeMessage: 'Requests to private network targets are not allowed.'
    })
  }
  if (!policy.allowHosts.some((entry) => hostMatches(url.hostname, entry))) {
    throw new McpKitError({
      code: 'FORBIDDEN',
      message: `Tool ${tool.name} attempted outbound request to non-allowlisted host ${url.hostname}`,
      safeMessage: 'The outbound destination is not allowlisted.'
    })
  }
  return url
}

function paginateItems<T>(
  items: readonly T[],
  policy: ToolOutputPolicy | undefined,
  options: {
    limit?: number
    cursor?: string
    encodeCursor?: (offset: number) => string
    decodeCursor?: (cursor: string) => number
  }
): PaginatedResult<T> {
  const maxPageSize = policy?.maxPageSize ?? items.length
  const requestedLimit = options.limit ?? policy?.defaultPageSize ?? maxPageSize
  const limit = clampPageSize(requestedLimit, maxPageSize)
  const decodeCursor = options.decodeCursor ?? defaultDecodeCursor
  const encodeCursor = options.encodeCursor ?? defaultEncodeCursor
  const start =
    options.cursor === undefined
      ? 0
      : normalizePageOffset(decodeCursor(options.cursor))
  const end = Math.min(start + limit, items.length)

  return {
    items: items.slice(start, end),
    limit,
    total: items.length,
    ...(end < items.length ? { nextCursor: encodeCursor(end) } : {})
  }
}

function paginationOptions(options: {
  limit: number | undefined
  cursor: string | undefined
  encodeCursor: ((offset: number) => string) | undefined
  decodeCursor: ((cursor: string) => number) | undefined
}): {
  limit?: number
  cursor?: string
  encodeCursor?: (offset: number) => string
  decodeCursor?: (cursor: string) => number
} {
  return {
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    ...(options.encodeCursor === undefined
      ? {}
      : { encodeCursor: options.encodeCursor }),
    ...(options.decodeCursor === undefined
      ? {}
      : { decodeCursor: options.decodeCursor })
  }
}

function clampPageSize(requestedLimit: number, maxPageSize: number): number {
  if (!Number.isInteger(requestedLimit) || requestedLimit <= 0) {
    throw new McpKitError({
      code: 'INVALID_ARGUMENT',
      message: `Invalid pagination limit: ${requestedLimit}`,
      safeMessage: 'Pagination limit must be a positive integer.'
    })
  }
  if (requestedLimit > maxPageSize) {
    throw new McpKitError({
      code: 'INVALID_ARGUMENT',
      message: `Requested pagination limit ${requestedLimit} exceeds max page size ${maxPageSize}`,
      safeMessage: `Pagination limit exceeds the configured maximum of ${maxPageSize}.`
    })
  }
  return requestedLimit
}

function normalizePageOffset(offset: number): number {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new McpKitError({
      code: 'INVALID_ARGUMENT',
      message: `Invalid pagination cursor offset: ${offset}`,
      safeMessage: 'Pagination cursor is invalid.'
    })
  }
  return offset
}

function defaultEncodeCursor(offset: number): string {
  return String(offset)
}

function defaultDecodeCursor(cursor: string): number {
  const offset = Number.parseInt(cursor, 10)
  if (!Number.isFinite(offset)) {
    throw new McpKitError({
      code: 'INVALID_ARGUMENT',
      message: `Invalid pagination cursor: ${cursor}`,
      safeMessage: 'Pagination cursor is invalid.'
    })
  }
  return offset
}

function normalizePathCandidate(candidate: string | URL): string {
  if (candidate instanceof URL) {
    if (candidate.protocol !== 'file:') {
      throw new McpKitError({
        code: 'FORBIDDEN',
        message: `Unsupported filesystem URL protocol: ${candidate.protocol}`,
        safeMessage: 'Filesystem access requires file paths or file URLs.'
      })
    }
    return resolvePath(fileURLToPath(candidate))
  }

  if (candidate.startsWith('file://')) {
    return resolvePath(fileURLToPath(new URL(candidate)))
  }

  return isAbsolute(candidate) ? resolvePath(candidate) : resolvePath(candidate)
}

function asFileUrl(root: string | URL): URL {
  if (root instanceof URL) {
    if (root.protocol !== 'file:') {
      throw new Error(
        `Filesystem root must use file: protocol, received ${root.protocol}`
      )
    }
    return new URL(root.toString())
  }
  if (root.startsWith('file://')) return new URL(root)
  return pathToFileURL(resolvePath(root))
}

async function nearestExistingAncestor(targetPath: string): Promise<string> {
  let current = targetPath
  while (true) {
    if (await exists(current)) return current
    const parent = dirname(current)
    if (parent === current) return current
    current = parent
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function isWithin(root: string, candidate: string): boolean {
  const normalizedRoot = stripTrailingSeparator(root)
  const normalizedCandidate = stripTrailingSeparator(candidate)
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}/`)
  )
}

function stripTrailingSeparator(path: string): string {
  return path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function decodedByteLength(data: string): number {
  return Buffer.from(data, 'base64').byteLength
}

function hostMatches(hostname: string, entry: string): boolean {
  const normalizedHost = hostname.toLowerCase()
  const normalizedEntry = entry.toLowerCase()
  if (normalizedEntry.startsWith('*.')) {
    const suffix = normalizedEntry.slice(1)
    return normalizedHost.endsWith(suffix) && normalizedHost !== suffix.slice(1)
  }
  return normalizedHost === normalizedEntry
}

function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (
    normalized === 'localhost' ||
    normalized === '[::1]' ||
    normalized === '::1'
  ) {
    return true
  }

  const ipv4 = normalized.match(/^(\d{1,3}\.){3}\d{1,3}$/)
  if (ipv4) {
    const [first = -1, second = -1] = normalized
      .split('.')
      .map((part) => Number.parseInt(part, 10))
    const parts = normalized.split('.').map((part) => Number.parseInt(part, 10))
    if (
      parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) {
      return false
    }
    return (
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    )
  }

  if (normalized.includes(':')) {
    return (
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:')
    )
  }

  return false
}
