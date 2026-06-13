import { getObjectShape } from '@modelcontextprotocol/sdk/server/zod-compat.js'

import type {
  PromptDefinition,
  ResourceDefinition,
  Schema,
  StaticResourceDefinition,
  TemplateResourceDefinition,
  ToolDefinition,
  ToolOptions
} from './contracts.js'
import { validateToolPolicy } from './capability-policy-validation.js'

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
  if (hasExclusiveResourceTarget(definition)) {
    return Object.freeze({ kind: 'resource', ...definition })
  }
  throw new Error(
    `Resource "${definition.name}" must define exactly one of uri or uriTemplate`
  )
}

export function definePrompt<ArgsSchema extends Schema, Services = unknown>(
  definition: Omit<PromptDefinition<ArgsSchema, Services>, 'kind'>
): PromptDefinition<ArgsSchema, Services> {
  if (getObjectShape(definition.argsSchema) !== undefined) {
    return Object.freeze({ kind: 'prompt', ...definition })
  }
  throw new Error(`Prompt "${definition.name}" argsSchema must be an object`)
}

function hasExclusiveResourceTarget(
  definition:
    | Omit<StaticResourceDefinition, 'kind'>
    | Omit<TemplateResourceDefinition, 'kind'>
): boolean {
  return (
    ('uri' in definition && definition.uri !== undefined) !==
    ('uriTemplate' in definition && definition.uriTemplate !== undefined)
  )
}
