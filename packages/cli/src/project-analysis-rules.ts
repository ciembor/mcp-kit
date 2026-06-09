import ts from 'typescript'

import type {
  Capability,
  ProjectDiagnostic,
  SourceFile
} from './project-analysis-types.js'
import {
  compareText,
  diagnostic,
  featureLayer,
  findProperty,
  hasExportModifier,
  propertyBoolean,
  propertyObject,
  propertyString,
  walk
} from './project-analysis-helpers.js'

const capabilityName = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/

export function analyzePorts(
  files: readonly SourceFile[]
): ProjectDiagnostic[] {
  const diagnostics: ProjectDiagnostic[] = []
  const implementations = new Set<string>()
  for (const file of files) {
    const layer = featureLayer(file.path)
    if (layer?.layer !== 'infrastructure') continue
    walk(file.source, (node) => {
      if (!ts.isClassDeclaration(node)) return
      for (const clause of node.heritageClauses ?? []) {
        if (clause.token !== ts.SyntaxKind.ImplementsKeyword) continue
        for (const type of clause.types) {
          implementations.add(`${layer.feature}:${type.expression.getText()}`)
        }
      }
    })
  }
  for (const file of files) {
    const match = /^src\/features\/([^/]+)\/application\/ports\//.exec(
      file.path
    )
    if (match === null) continue
    for (const statement of file.source.statements) {
      if (!ts.isInterfaceDeclaration(statement)) continue
      if (!hasExportModifier(statement)) continue
      const key = `${match[1]}:${statement.name.text}`
      if (!implementations.has(key)) {
        diagnostics.push(
          diagnostic(
            'application-port-implementation',
            file,
            `application port "${statement.name.text}" has no infrastructure implementation`,
            statement
          )
        )
      }
    }
  }
  return diagnostics
}

export function analyzeCapabilities(
  files: readonly SourceFile[]
): ProjectDiagnostic[] {
  const diagnostics: ProjectDiagnostic[] = []
  const capabilities = files.flatMap(findCapabilities)
  const names = new Map<string, Capability[]>()
  let style: 'kebab' | 'snake' | undefined

  for (const capability of capabilities) {
    const name = propertyString(capability.definition, 'name')
    if (
      findProperty(capability.definition, 'requiredScopes') !== undefined &&
      findProperty(capability.definition, 'policy') === undefined
    ) {
      diagnostics.push(
        diagnostic(
          'protected-capability-requires-policy',
          capability.file,
          'protected capability must declare requiredScopes inside policy',
          capability.definition
        )
      )
    }
    if (name !== undefined) capability.name = name
    if (name === undefined || !capabilityName.test(name)) {
      diagnostics.push(
        diagnostic(
          'capability-name',
          capability.file,
          'capability name must use a stable lowercase kebab-case or snake_case name',
          capability.definition
        )
      )
    } else {
      const currentStyle = name.includes('_') ? 'snake' : 'kebab'
      if (style === undefined) style = currentStyle
      if (style !== currentStyle) {
        diagnostics.push(
          diagnostic(
            'capability-name-style',
            capability.file,
            `capability name "${name}" does not use the project ${style}-case style`,
            capability.definition
          )
        )
      }
      const existing = names.get(name) ?? []
      existing.push(capability)
      names.set(name, existing)
    }
    if (capability.kind === 'tool') {
      diagnostics.push(...analyzeTool(capability))
    }
  }

  for (const [name, duplicates] of names) {
    if (duplicates.length < 2) continue
    for (const duplicate of duplicates) {
      diagnostics.push(
        diagnostic(
          'unique-capability-name',
          duplicate.file,
          `capability name "${name}" is duplicated`,
          duplicate.definition
        )
      )
    }
  }
  return diagnostics
}

export function analyzeRegistry(
  files: readonly SourceFile[]
): ProjectDiagnostic[] {
  const diagnostics: ProjectDiagnostic[] = []
  for (const file of files) {
    if (!/\/registry\.[cm]?[jt]sx?$/.test(file.path)) continue
    walk(file.source, (node) => {
      if (
        !ts.isCallExpression(node) ||
        node.expression.getText() !== 'defineRegistry'
      ) {
        return
      }
      const argument = node.arguments[0]
      if (argument === undefined || !ts.isArrayLiteralExpression(argument)) {
        return
      }
      const names = argument.elements.map((element) => element.getText())
      const sorted = [...names].sort(compareText)
      if (names.some((name, index) => name !== sorted[index])) {
        diagnostics.push(
          diagnostic(
            'deterministic-registry',
            file,
            'registry entries must be sorted deterministically',
            argument
          )
        )
      }
    })
  }
  return diagnostics
}

function analyzeTool(capability: Capability): ProjectDiagnostic[] {
  const diagnostics: ProjectDiagnostic[] = []
  const definition = capability.definition
  const policy = propertyObject(definition, 'policy')
  const annotations = propertyObject(definition, 'annotations')
  const effects =
    policy === undefined ? undefined : propertyString(policy, 'effects')
  const hasOutputSchema = findProperty(definition, 'outputSchema') !== undefined
  const handler = findProperty(definition, 'handler')

  if (
    handler !== undefined &&
    handler.getText().includes('structuredContent') &&
    !hasOutputSchema
  ) {
    diagnostics.push(
      diagnostic(
        'structured-output-requires-output-schema',
        capability.file,
        'tool returning structuredContent must declare outputSchema',
        handler
      )
    )
  }
  if (
    capability.name !== undefined &&
    /^list[-_]/.test(capability.name) &&
    !definition.getText().includes('limit')
  ) {
    diagnostics.push(
      diagnostic(
        'no-unbounded-list-tool-without-limit',
        capability.file,
        'list tool input must include a limit',
        definition
      )
    )
  }
  if (
    effects === 'read' &&
    propertyBoolean(annotations, 'readOnlyHint') !== true
  ) {
    diagnostics.push(
      diagnostic(
        'policy-annotations',
        capability.file,
        'read-only policy requires readOnlyHint: true',
        definition
      )
    )
  }
  if (effects === 'write') {
    if (propertyBoolean(annotations, 'readOnlyHint') !== false) {
      diagnostics.push(
        diagnostic(
          'policy-annotations',
          capability.file,
          'write policy requires readOnlyHint: false',
          definition
        )
      )
    }
    if (propertyBoolean(annotations, 'destructiveHint') === undefined) {
      diagnostics.push(
        diagnostic(
          'destructive-hint',
          capability.file,
          'write policy must explicitly declare destructiveHint',
          definition
        )
      )
    }
  }
  if (
    effects !== undefined &&
    propertyBoolean(annotations, 'openWorldHint') === undefined
  ) {
    diagnostics.push(
      diagnostic(
        'open-world-hint',
        capability.file,
        'tool policy must explicitly declare openWorldHint',
        definition
      )
    )
  }
  return diagnostics
}

function findCapabilities(file: SourceFile): Capability[] {
  const capabilities: Capability[] = []
  walk(file.source, (node) => {
    if (!ts.isCallExpression(node) || node.arguments.length === 0) return
    const kinds = {
      defineTool: 'tool',
      defineResource: 'resource',
      definePrompt: 'prompt'
    } as const
    const expression = node.expression.getText()
    const kind =
      expression in kinds ? kinds[expression as keyof typeof kinds] : undefined
    const definition = node.arguments[0]
    if (
      kind !== undefined &&
      definition !== undefined &&
      ts.isObjectLiteralExpression(definition)
    ) {
      capabilities.push({ file, kind, definition })
    }
  })
  return capabilities
}
