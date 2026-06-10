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
}
