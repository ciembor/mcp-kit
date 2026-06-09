import { createHash } from 'node:crypto'

import { exitCodes, type JsonObject, type JsonValue } from './cli-contracts.js'
import { CliError } from './cli-error.js'

export function asJsonObject(value: JsonValue | undefined): JsonObject {
  return isJsonObject(value) ? value : {}
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function toPackageName(value: string): string {
  const normalized = toKebabName(value)
  if (normalized === '') {
    throw new CliError(
      `Cannot derive a package name from "${value}"`,
      exitCodes.validation
    )
  }
  return normalized
}

export function toKebabName(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
  return trimEdgeHyphens(normalized)
}

export function toCamelName(value: string): string {
  const kebab = toKebabName(value)
  return kebab.replace(/-([a-z0-9])/g, (_match, letter: string) =>
    letter.toUpperCase()
  )
}

export function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}

function trimEdgeHyphens(value: string): string {
  let start = 0
  let end = value.length
  while (value[start] === '-') start += 1
  while (value[end - 1] === '-') end -= 1
  return value.slice(start, end)
}
