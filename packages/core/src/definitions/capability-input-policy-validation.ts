import type { ToolPolicy } from './contracts.js'

export function validateInputPolicy(
  toolName: string,
  input: ToolPolicy['input']
): void {
  if (input === undefined) return
  const entries = Object.entries(input.fields)
  if (entries.length === 0) {
    throw new Error(`Tool "${toolName}" policy.input.fields must not be empty`)
  }

  for (const [path, field] of entries) {
    validateInputFieldPath(toolName, path)
    validateInputField(toolName, path, field)
  }
}

function validateInputFieldPath(toolName: string, path: string): void {
  if (path.trim() !== '') return
  throw new Error(
    `Tool "${toolName}" policy.input field path must not be empty`
  )
}

function validateInputField(
  toolName: string,
  path: string,
  field: NonNullable<ToolPolicy['input']>['fields'][string]
): void {
  switch (field.kind) {
    case 'string':
      validateStringInputField(toolName, path, field)
      return
    case 'number':
      validateNumberInputField(toolName, path, field)
      return
    case 'collection':
      validateCollectionInputField(toolName, path, field)
      return
    case 'url':
    case 'host':
      validateAllowHosts(
        toolName,
        `policy.input.fields.${path}.allowHosts`,
        field.allowHosts
      )
      return
    case 'filesystemPath':
      validateFilesystemInputField(toolName, path, field)
  }
}

function validateStringInputField(
  toolName: string,
  path: string,
  field: Extract<
    NonNullable<ToolPolicy['input']>['fields'][string],
    { kind: 'string' }
  >
): void {
  validateNonNegativeInteger(toolName, `${path}.minLength`, field.minLength)
  validateNonNegativeInteger(toolName, `${path}.maxLength`, field.maxLength)
  validateMinMax({
    toolName,
    path,
    minLabel: 'minLength',
    min: field.minLength,
    maxLabel: 'maxLength',
    max: field.maxLength
  })
}

function validateNumberInputField(
  toolName: string,
  path: string,
  field: Extract<
    NonNullable<ToolPolicy['input']>['fields'][string],
    { kind: 'number' }
  >
): void {
  validateMinMax({
    toolName,
    path,
    minLabel: 'min',
    min: field.min,
    maxLabel: 'max',
    max: field.max
  })
}

function validateCollectionInputField(
  toolName: string,
  path: string,
  field: Extract<
    NonNullable<ToolPolicy['input']>['fields'][string],
    { kind: 'collection' }
  >
): void {
  validateNonNegativeInteger(toolName, `${path}.minItems`, field.minItems)
  validateNonNegativeInteger(toolName, `${path}.maxItems`, field.maxItems)
  validateMinMax({
    toolName,
    path,
    minLabel: 'minItems',
    min: field.minItems,
    maxLabel: 'maxItems',
    max: field.maxItems
  })
}

function validateFilesystemInputField(
  toolName: string,
  path: string,
  field: Extract<
    NonNullable<ToolPolicy['input']>['fields'][string],
    { kind: 'filesystemPath' }
  >
): void {
  if (
    field.roots !== undefined ||
    field.clientRoots === true ||
    field.clientRoots === 'require'
  ) {
    return
  }
  throw new Error(
    `Tool "${toolName}" policy.input field "${path}" filesystemPath requires roots or clientRoots`
  )
}

function validateAllowHosts(
  toolName: string,
  fieldName: string,
  allowHosts: readonly string[] | undefined
): void {
  if (allowHosts === undefined) return
  if (allowHosts.length === 0) {
    throw new Error(`Tool "${toolName}" ${fieldName} must not be empty`)
  }
}

function validateNonNegativeInteger(
  toolName: string,
  fieldName: string,
  value: number | undefined
): void {
  if (value === undefined) return
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `Tool "${toolName}" ${fieldName} must be a non-negative integer`
    )
  }
}

function validateMinMax(args: {
  toolName: string
  path: string
  minLabel: string
  min: number | undefined
  maxLabel: string
  max: number | undefined
}): void {
  if (
    args.min === undefined ||
    args.max === undefined ||
    args.min <= args.max
  ) {
    return
  }
  throw new Error(
    `Tool "${args.toolName}" policy.input field "${args.path}" ${args.minLabel} must not exceed ${args.maxLabel}`
  )
}
