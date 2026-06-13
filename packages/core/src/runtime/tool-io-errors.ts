import { McpKitError } from '../definitions.js'

export function unavailableToolIoError(): McpKitError {
  return new McpKitError({
    code: 'POLICY',
    message:
      'Tool I/O helpers are only available while executing a tool handler',
    safeMessage: 'The operation is not available in this context.'
  })
}

export function invalidInput(
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

export function normalizeInputError(
  error: unknown,
  toolName: string,
  path: string
): McpKitError {
  if (error instanceof McpKitError || error instanceof Error) {
    return new McpKitError({
      code: 'INVALID_ARGUMENT',
      message: error.message,
      safeMessage: `Input "${path}" is not allowed.`
    })
  }
  return invalidInput(toolName, path, 'is not allowed')
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function valueAtPath(input: unknown, path: string): unknown {
  let current = input
  for (const segment of path.split('.')) {
    if (!isRecord(current)) return undefined
    current = current[segment]
  }
  return current
}
