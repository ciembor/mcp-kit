import ts from 'typescript'

import type { Capability, ProjectDiagnostic } from './project-analysis-types.js'
import {
  diagnostic,
  findProperty,
  propertyBoolean,
  propertyObject,
  propertyString
} from './project-analysis-helpers.js'

type ToolContext = ReturnType<typeof toolContext>
type ToolRule = (context: ToolContext) => ProjectDiagnostic | undefined

export function analyzeTool(capability: Capability): ProjectDiagnostic[] {
  const context = toolContext(capability)
  return toolRules.flatMap((rule) => rule(context) ?? [])
}

function toolContext(capability: Capability) {
  const definition = capability.definition
  const policy = propertyObject(definition, 'policy')
  return {
    capability,
    definition,
    annotations: propertyObject(definition, 'annotations'),
    effects:
      policy === undefined ? undefined : propertyString(policy, 'effects'),
    handler: findProperty(definition, 'handler')
  }
}

function toolDiagnostic(
  context: ToolContext,
  rule: string,
  message: string,
  node: ts.Node = context.definition
): ProjectDiagnostic {
  return diagnostic(rule, context.capability.file, message, node)
}

const toolRules: readonly ToolRule[] = [
  (context) =>
    context.handler?.getText().includes('structuredContent') === true &&
    findProperty(context.definition, 'outputSchema') === undefined
      ? toolDiagnostic(
          context,
          'structured-output-requires-output-schema',
          'tool returning structuredContent must declare outputSchema',
          context.handler
        )
      : undefined,
  (context) =>
    context.capability.name !== undefined &&
    /^list[-_]/.test(context.capability.name) &&
    !context.definition.getText().includes('limit')
      ? toolDiagnostic(
          context,
          'no-unbounded-list-tool-without-limit',
          'list tool input must include a limit'
        )
      : undefined,
  (context) =>
    context.effects === 'read' &&
    propertyBoolean(context.annotations, 'readOnlyHint') !== true
      ? toolDiagnostic(
          context,
          'policy-annotations',
          'read-only policy requires readOnlyHint: true'
        )
      : undefined,
  (context) =>
    context.effects === 'write' &&
    propertyBoolean(context.annotations, 'readOnlyHint') !== false
      ? toolDiagnostic(
          context,
          'policy-annotations',
          'write policy requires readOnlyHint: false'
        )
      : undefined,
  (context) =>
    context.effects === 'write' &&
    propertyBoolean(context.annotations, 'destructiveHint') === undefined
      ? toolDiagnostic(
          context,
          'destructive-hint',
          'write policy must explicitly declare destructiveHint'
        )
      : undefined,
  (context) =>
    context.effects !== undefined &&
    propertyBoolean(context.annotations, 'openWorldHint') === undefined
      ? toolDiagnostic(
          context,
          'open-world-hint',
          'tool policy must explicitly declare openWorldHint'
        )
      : undefined
]
