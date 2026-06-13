import { getObjectShape } from '@modelcontextprotocol/sdk/server/zod-compat.js'
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'

import type {
  PromptDefinition,
  ResourceDefinition,
  Schema,
  StaticResourceDefinition,
  TemplateResourceDefinition,
  ToolDefinition,
  ToolOptions,
  ToolPolicy
} from './contracts.js'

export function defineTool<InputSchema extends Schema, Services = unknown>(
  definition: ToolOptions<InputSchema, Services>
): ToolDefinition<InputSchema, Services> {
  validateToolPolicy(definition)
  return Object.freeze({ kind: 'tool', ...definition })
}

export function defineResource<Services = unknown>(
  definition: Omit<StaticResourceDefinition<Services>, 'kind'>
): StaticResourceDefinition<Services>
export function defineResource<Template extends string, Services = unknown>(
  definition: Omit<TemplateResourceDefinition<Template, Services>, 'kind'>
): TemplateResourceDefinition<Template, Services>
export function defineResource(
  definition:
    | Omit<StaticResourceDefinition, 'kind'>
    | Omit<TemplateResourceDefinition, 'kind'>
): ResourceDefinition {
  if (
    ('uri' in definition && definition.uri !== undefined) ===
    ('uriTemplate' in definition && definition.uriTemplate !== undefined)
  ) {
    throw new Error(
      `Resource "${definition.name}" must define exactly one of uri or uriTemplate`
    )
  }
  return Object.freeze({ kind: 'resource', ...definition })
}

export function definePrompt<ArgsSchema extends Schema, Services = unknown>(
  definition: Omit<PromptDefinition<ArgsSchema, Services>, 'kind'>
): PromptDefinition<ArgsSchema, Services> {
  if (getObjectShape(definition.argsSchema) === undefined) {
    throw new Error(`Prompt "${definition.name}" argsSchema must be an object`)
  }
  return Object.freeze({ kind: 'prompt', ...definition })
}

function validateToolPolicy(definition: {
  name: string
  outputSchema?: Schema
  annotations?: ToolAnnotations
  policy?: ToolPolicy
}): void {
  const invalidHint =
    definition.policy?.effects === 'read'
      ? definition.annotations?.readOnlyHint === false
      : definition.policy?.effects === 'write' &&
        definition.annotations?.readOnlyHint === true
  if (invalidHint) {
    throw new Error(
      `Tool "${definition.name}" has ${definition.policy!.effects} effects but readOnlyHint is ${String(definition.annotations!.readOnlyHint)}`
    )
  }

  if (
    definition.annotations?.destructiveHint === true &&
    definition.policy?.destructive === undefined
  ) {
    throw new Error(
      `Tool "${definition.name}" declares destructiveHint but is missing policy.destructive`
    )
  }

  if (definition.policy?.destructive !== undefined) {
    if (definition.policy.effects !== 'write') {
      throw new Error(
        `Tool "${definition.name}" destructive policy requires write effects`
      )
    }
    if (definition.annotations?.destructiveHint !== true) {
      throw new Error(
        `Tool "${definition.name}" destructive policy requires destructiveHint: true`
      )
    }
  }

  const output = definition.policy?.output
  if (
    output?.defaultPageSize !== undefined &&
    output.maxPageSize !== undefined &&
    output.defaultPageSize > output.maxPageSize
  ) {
    throw new Error(
      `Tool "${definition.name}" output.defaultPageSize must not exceed output.maxPageSize`
    )
  }

  if (
    definition.policy?.outboundHttp !== undefined &&
    definition.outputSchema === undefined
  ) {
    throw new Error(
      `Tool "${definition.name}" outboundHttp policy requires outputSchema`
    )
  }

  validatePositiveInteger(
    definition.name,
    'policy.timeoutMs',
    definition.policy?.timeoutMs
  )
  validatePositiveInteger(
    definition.name,
    'policy.concurrency',
    definition.policy?.concurrency
  )
  validatePositiveInteger(
    definition.name,
    'policy.rateLimit.windowMs',
    definition.policy?.rateLimit?.windowMs
  )
  validatePositiveInteger(
    definition.name,
    'policy.rateLimit.maxCalls',
    definition.policy?.rateLimit?.maxCalls
  )
  validateAllowHosts(
    definition.name,
    'policy.outboundHttp.allowHosts',
    definition.policy?.outboundHttp?.allowHosts
  )
  validateInputPolicy(definition.name, definition.policy?.input)
}

function validateInputPolicy(
  toolName: string,
  input: ToolPolicy['input']
): void {
  if (input === undefined) return
  const entries = Object.entries(input.fields)
  if (entries.length === 0) {
    throw new Error(`Tool "${toolName}" policy.input.fields must not be empty`)
  }

  for (const [path, field] of entries) {
    if (path.trim() === '') {
      throw new Error(
        `Tool "${toolName}" policy.input field path must not be empty`
      )
    }

    switch (field.kind) {
      case 'string':
        validateNonNegativeInteger(
          toolName,
          `${path}.minLength`,
          field.minLength
        )
        validateNonNegativeInteger(
          toolName,
          `${path}.maxLength`,
          field.maxLength
        )
        if (
          field.minLength !== undefined &&
          field.maxLength !== undefined &&
          field.minLength > field.maxLength
        ) {
          throw new Error(
            `Tool "${toolName}" policy.input field "${path}" minLength must not exceed maxLength`
          )
        }
        break
      case 'number':
        if (
          field.min !== undefined &&
          field.max !== undefined &&
          field.min > field.max
        ) {
          throw new Error(
            `Tool "${toolName}" policy.input field "${path}" min must not exceed max`
          )
        }
        break
      case 'collection':
        validateNonNegativeInteger(toolName, `${path}.minItems`, field.minItems)
        validateNonNegativeInteger(toolName, `${path}.maxItems`, field.maxItems)
        if (
          field.minItems !== undefined &&
          field.maxItems !== undefined &&
          field.minItems > field.maxItems
        ) {
          throw new Error(
            `Tool "${toolName}" policy.input field "${path}" minItems must not exceed maxItems`
          )
        }
        break
      case 'url':
        validateAllowHosts(
          toolName,
          `policy.input.fields.${path}.allowHosts`,
          field.allowHosts
        )
        break
      case 'host':
        validateAllowHosts(
          toolName,
          `policy.input.fields.${path}.allowHosts`,
          field.allowHosts
        )
        break
      case 'filesystemPath':
        if (
          field.roots === undefined &&
          field.clientRoots !== true &&
          field.clientRoots !== 'require'
        ) {
          throw new Error(
            `Tool "${toolName}" policy.input field "${path}" filesystemPath requires roots or clientRoots`
          )
        }
        break
    }
  }
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

function validatePositiveInteger(
  toolName: string,
  fieldName: string,
  value: number | undefined
): void {
  if (value === undefined) return
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `Tool "${toolName}" ${fieldName} must be a positive integer`
    )
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
