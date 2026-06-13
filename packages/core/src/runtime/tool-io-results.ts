import type {
  PaginatedResult,
  ToolDefinition,
  ToolOutputPolicy
} from '../definitions.js'
import { McpKitError, type Schema } from '../definitions.js'

export function validateToolResultLimits<Services>(
  tool: ToolDefinition<Schema, Services>,
  result: Awaited<ReturnType<ToolDefinition<Schema, Services>['handler']>>
): void {
  const output = tool.policy?.output
  if (output === undefined) return

  assertContentItemLimit(
    tool.name,
    result.content.length,
    output.maxContentItems
  )
  for (const item of result.content) {
    assertTextLength(tool.name, item, output.maxTextChars)
    assertBlobSize(tool.name, item, output.maxBlobBytes)
  }
  assertStructuredContentSize(
    tool.name,
    result.structuredContent,
    output.maxStructuredBytes
  )
}

export function paginateItems<T>(
  items: readonly T[],
  policy: ToolOutputPolicy | undefined,
  options: PaginationOptions
): PaginatedResult<T> {
  const maxPageSize = policy?.maxPageSize ?? items.length
  const requestedLimit = options.limit ?? policy?.defaultPageSize ?? maxPageSize
  const limit = clampPageSize(requestedLimit, maxPageSize)
  const start = decodePageOffset(options.cursor, options.decodeCursor)
  const end = Math.min(start + limit, items.length)
  return {
    items: items.slice(start, end),
    limit,
    total: items.length,
    ...(end < items.length
      ? { nextCursor: (options.encodeCursor ?? defaultEncodeCursor)(end) }
      : {})
  }
}

export function paginationOptions(options: {
  limit: number | undefined
  cursor: string | undefined
  encodeCursor: ((offset: number) => string) | undefined
  decodeCursor: ((cursor: string) => number) | undefined
}): PaginationOptions {
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

type PaginationOptions = {
  limit?: number
  cursor?: string
  encodeCursor?: (offset: number) => string
  decodeCursor?: (cursor: string) => number
}

function assertContentItemLimit(
  toolName: string,
  count: number,
  maxContentItems: number | undefined
): void {
  if (maxContentItems === undefined || count <= maxContentItems) return
  throw outputLimit(
    toolName,
    `${count} content items, exceeding the limit of ${maxContentItems}`
  )
}

function assertTextLength(
  toolName: string,
  item: unknown,
  maxTextChars: number | undefined
): void {
  if (
    maxTextChars === undefined ||
    !hasStringField(item, 'text') ||
    item.text.length <= maxTextChars
  ) {
    return
  }
  throw outputLimit(toolName, `text exceeding ${maxTextChars} characters`)
}

function assertBlobSize(
  toolName: string,
  item: unknown,
  maxBlobBytes: number | undefined
): void {
  if (
    maxBlobBytes === undefined ||
    !hasStringField(item, 'data') ||
    decodedByteLength(item.data) <= maxBlobBytes
  ) {
    return
  }
  throw outputLimit(toolName, `blob data exceeding ${maxBlobBytes} bytes`)
}

function assertStructuredContentSize(
  toolName: string,
  structuredContent: unknown,
  maxStructuredBytes: number | undefined
): void {
  if (
    maxStructuredBytes === undefined ||
    structuredContent === undefined ||
    Buffer.byteLength(JSON.stringify(structuredContent), 'utf8') <=
      maxStructuredBytes
  ) {
    return
  }
  throw outputLimit(
    toolName,
    `structured content exceeding ${maxStructuredBytes} bytes`
  )
}

function outputLimit(toolName: string, detail: string): McpKitError {
  return new McpKitError({
    code: 'OUTPUT_LIMIT',
    message: `Tool ${toolName} returned ${detail}`,
    safeMessage: 'The operation returned too much data.'
  })
}

function decodePageOffset(
  cursor: string | undefined,
  decodeCursor: ((cursor: string) => number) | undefined
): number {
  if (cursor === undefined) return 0
  return normalizePageOffset((decodeCursor ?? defaultDecodeCursor)(cursor))
}

function clampPageSize(requestedLimit: number, maxPageSize: number): number {
  if (!Number.isInteger(requestedLimit) || requestedLimit <= 0) {
    throw new McpKitError({
      code: 'INVALID_ARGUMENT',
      message: `Invalid pagination limit: ${requestedLimit}`,
      safeMessage: 'Pagination limit must be a positive integer.'
    })
  }
  if (requestedLimit <= maxPageSize) return requestedLimit
  throw new McpKitError({
    code: 'INVALID_ARGUMENT',
    message: `Requested pagination limit ${requestedLimit} exceeds max page size ${maxPageSize}`,
    safeMessage: `Pagination limit exceeds the configured maximum of ${maxPageSize}.`
  })
}

function normalizePageOffset(offset: number): number {
  if (Number.isInteger(offset) && offset >= 0) return offset
  throw new McpKitError({
    code: 'INVALID_ARGUMENT',
    message: `Invalid pagination cursor offset: ${offset}`,
    safeMessage: 'Pagination cursor is invalid.'
  })
}

function defaultEncodeCursor(offset: number): string {
  return String(offset)
}

function defaultDecodeCursor(cursor: string): number {
  const offset = Number.parseInt(cursor, 10)
  if (Number.isFinite(offset)) return offset
  throw new McpKitError({
    code: 'INVALID_ARGUMENT',
    message: `Invalid pagination cursor: ${cursor}`,
    safeMessage: 'Pagination cursor is invalid.'
  })
}

function decodedByteLength(data: string): number {
  return Buffer.from(data, 'base64').byteLength
}

function hasStringField<Key extends string>(
  value: unknown,
  key: Key
): value is Record<Key, string> {
  return (
    value !== null &&
    typeof value === 'object' &&
    key in value &&
    typeof (value as Record<Key, unknown>)[key] === 'string'
  )
}
