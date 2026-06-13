import type {
  PaginatedResult,
  RequestContext,
  Schema,
  ToolDefinition,
  ToolIo,
  ToolInputFieldPolicy
} from '../definitions.js'
import { McpKitError } from '../definitions.js'

import {
  assertAllowedOutboundUrl,
  validateHostField,
  validateUrlField
} from './tool-io-network.js'
import {
  unavailableToolIoError,
  valueAtPath,
  isRecord
} from './tool-io-errors.js'
import {
  resolveToolPath,
  toolFilesystemRoots,
  validateFilesystemPathField
} from './tool-io-filesystem.js'
import {
  paginateItems,
  paginationOptions,
  validateToolResultLimits
} from './tool-io-results.js'

export { validateToolResultLimits }

export function unavailableToolIo(): ToolIo {
  return {
    files: {
      resolvePath: () => Promise.reject(unavailableToolIoError()),
      roots: () => Promise.resolve([])
    },
    http: {
      assertAllowed: () => {
        throw unavailableToolIoError()
      }
    },
    results: {
      paginate: <T>(options: PaginationArgs<T>): PaginatedResult<T> =>
        paginateItems(options.items, {}, paginationArgs(options))
    },
    destructive: {
      assertConfirmation: () => {
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
      paginate: <T>(options: PaginationArgs<T>): PaginatedResult<T> =>
        paginateItems(
          options.items,
          tool.policy?.output,
          paginationArgs(options)
        )
    },
    destructive: {
      assertConfirmation: (input) => assertDestructiveConfirmation(tool, input)
    }
  }
}

export async function validateToolInputPolicies<Services>(
  tool: ToolDefinition<Schema, Services>,
  input: unknown,
  context: RequestContext<Services>
): Promise<void> {
  const fields = tool.policy?.input?.fields
  if (fields === undefined) return

  for (const [path, policy] of Object.entries(fields)) {
    const value = valueAtPath(input, path)
    if (value === undefined) continue
    await validateInputField({ tool, context, path, policy, value })
  }
}

export function assertDestructiveConfirmation<Services>(
  tool: ToolDefinition<Schema, Services>,
  input: unknown
): void {
  const confirmation = tool.policy?.destructive?.requireConfirmation
  if (confirmation === undefined || confirmation === false) return

  const { field, expected } = confirmationConfig(confirmation)
  if (isRecord(input) && input[field] === expected) return

  throw destructiveConfirmationError(tool.name, field)
}

type PaginationArgs<T> = {
  items: readonly T[]
  limit?: number
  cursor?: string
  encodeCursor?: (offset: number) => string
  decodeCursor?: (cursor: string) => number
}

function paginationArgs<T>(options: PaginationArgs<T>) {
  return paginationOptions({
    limit: options.limit,
    cursor: options.cursor,
    encodeCursor: options.encodeCursor,
    decodeCursor: options.decodeCursor
  })
}

async function validateInputField<Services>(args: {
  tool: ToolDefinition<Schema, Services>
  context: RequestContext<Services>
  path: string
  policy: ToolInputFieldPolicy
  value: unknown
}): Promise<void> {
  switch (args.policy.kind) {
    case 'string':
      validateStringField(args.tool.name, args.path, args.policy, args.value)
      return
    case 'number':
      validateNumberField(args.tool.name, args.path, args.policy, args.value)
      return
    case 'collection':
      validateCollectionField(
        args.tool.name,
        args.path,
        args.policy,
        args.value
      )
      return
    case 'url':
      validateUrlField(args.tool.name, args.path, args.policy, args.value)
      return
    case 'host':
      validateHostField(args.tool.name, args.path, args.policy, args.value)
      return
    case 'filesystemPath':
      return validateFilesystemPathField({
        ...args,
        policy: args.policy
      })
  }
}

function validateStringField(
  toolName: string,
  path: string,
  policy: Extract<ToolInputFieldPolicy, { kind: 'string' }>,
  value: unknown
): void {
  if (typeof value !== 'string') return
  if (policy.minLength !== undefined && value.length < policy.minLength) {
    throw invalidArgument(
      toolName,
      path,
      `must be at least ${policy.minLength} characters long`
    )
  }
  if (policy.maxLength !== undefined && value.length > policy.maxLength) {
    throw invalidArgument(
      toolName,
      path,
      `must be at most ${policy.maxLength} characters long`
    )
  }
}

function validateNumberField(
  toolName: string,
  path: string,
  policy: Extract<ToolInputFieldPolicy, { kind: 'number' }>,
  value: unknown
): void {
  if (typeof value !== 'number' || Number.isNaN(value)) return
  if (policy.integer === true && !Number.isInteger(value)) {
    throw invalidArgument(toolName, path, 'must be an integer')
  }
  assertLowerBound(toolName, path, value, policy.min)
  assertUpperBound(toolName, path, value, policy.max)
}

function validateCollectionField(
  toolName: string,
  path: string,
  policy: Extract<ToolInputFieldPolicy, { kind: 'collection' }>,
  value: unknown
): void {
  if (!Array.isArray(value)) return
  if (policy.minItems !== undefined && value.length < policy.minItems) {
    throw invalidArgument(
      toolName,
      path,
      `must contain at least ${policy.minItems} items`
    )
  }
  if (policy.maxItems !== undefined && value.length > policy.maxItems) {
    throw invalidArgument(
      toolName,
      path,
      `must contain at most ${policy.maxItems} items`
    )
  }
}

function assertLowerBound(
  toolName: string,
  path: string,
  value: number,
  min: number | undefined
): void {
  if (min === undefined || value >= min) return
  throw invalidArgument(
    toolName,
    path,
    `must be greater than or equal to ${min}`
  )
}

function assertUpperBound(
  toolName: string,
  path: string,
  value: number,
  max: number | undefined
): void {
  if (max === undefined || value <= max) return
  throw invalidArgument(toolName, path, `must be less than or equal to ${max}`)
}

function invalidArgument(
  toolName: string,
  path: string,
  detail: string
): McpKitError {
  return new McpKitError({
    code: 'INVALID_ARGUMENT',
    message: `Tool ${toolName} input "${path}" ${detail}`,
    safeMessage: `Input "${path}" ${detail}.`
  })
}

function destructiveConfirmationError(
  toolName: string,
  field: string
): McpKitError {
  return new McpKitError({
    code: 'FORBIDDEN',
    message: `Tool ${toolName} requires destructive confirmation via input field "${field}"`,
    safeMessage: 'This operation requires explicit confirmation.'
  })
}

function confirmationConfig(
  confirmation: NonNullable<
    NonNullable<ToolDefinition['policy']>['destructive']
  >['requireConfirmation']
): {
  field: string
  expected: string | number | boolean
} {
  return typeof confirmation === 'object'
    ? {
        field: confirmation.field,
        expected: confirmation.value ?? true
      }
    : { field: 'confirm', expected: true }
}
