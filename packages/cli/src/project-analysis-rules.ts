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
  propertyString,
  walk
} from './project-analysis-helpers.js'
import { analyzeTool } from './project-analysis-tool-rules.js'

const capabilityName = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/
type CapabilityNameStyle = 'kebab' | 'snake'

export function analyzePorts(
  files: readonly SourceFile[]
): ProjectDiagnostic[] {
  const implementations = findPortImplementations(files)
  return files.flatMap((file) =>
    missingPortImplementations(file, implementations)
  )
}

function findPortImplementations(files: readonly SourceFile[]): Set<string> {
  const implementations = new Set<string>()
  for (const file of files) {
    const layer = featureLayer(file.path)
    if (layer?.layer !== 'infrastructure') continue
    walk(file.source, (node) =>
      collectImplementedPorts(node, layer.feature, implementations)
    )
  }
  return implementations
}

function collectImplementedPorts(
  node: ts.Node,
  feature: string,
  implementations: Set<string>
): void {
  if (!ts.isClassDeclaration(node)) return
  const clauses =
    node.heritageClauses?.filter(
      (clause) => clause.token === ts.SyntaxKind.ImplementsKeyword
    ) ?? []
  for (const type of clauses.flatMap((clause) => [...clause.types])) {
    implementations.add(`${feature}:${type.expression.getText()}`)
  }
}

function missingPortImplementations(
  file: SourceFile,
  implementations: ReadonlySet<string>
): ProjectDiagnostic[] {
  const feature = /^src\/features\/([^/]+)\/application\/ports\//.exec(
    file.path
  )?.[1]
  if (feature === undefined) return []
  return file.source.statements
    .filter(ts.isInterfaceDeclaration)
    .filter(hasExportModifier)
    .filter(
      (statement) => !implementations.has(`${feature}:${statement.name.text}`)
    )
    .map((statement) =>
      diagnostic(
        'application-port-implementation',
        file,
        `application port "${statement.name.text}" has no infrastructure implementation`,
        statement
      )
    )
}

export function analyzeCapabilities(
  files: readonly SourceFile[]
): ProjectDiagnostic[] {
  const diagnostics: ProjectDiagnostic[] = []
  const capabilities = files.flatMap(findCapabilities)
  const names = new Map<string, Capability[]>()
  let style: CapabilityNameStyle | undefined

  for (const capability of capabilities) {
    diagnostics.push(...analyzeCapabilityPolicy(capability))
    const result = analyzeCapabilityName(capability, style)
    style ??= result.style
    diagnostics.push(...result.diagnostics)
    if (capability.name !== undefined) {
      const existing = names.get(capability.name) ?? []
      existing.push(capability)
      names.set(capability.name, existing)
    }
    diagnostics.push(...analyzeCapabilityKind(capability))
  }
  diagnostics.push(...duplicateNameDiagnostics(names))
  return diagnostics
}

function analyzeCapabilityKind(capability: Capability): ProjectDiagnostic[] {
  return capability.kind === 'tool' ? analyzeTool(capability) : []
}

function duplicateNameDiagnostics(
  names: ReadonlyMap<string, readonly Capability[]>
): ProjectDiagnostic[] {
  return [...names].flatMap(([name, duplicates]) =>
    duplicates.length < 2
      ? []
      : duplicates.map((duplicate) =>
          diagnostic(
            'unique-capability-name',
            duplicate.file,
            `capability name "${name}" is duplicated`,
            duplicate.definition
          )
        )
  )
}

function analyzeCapabilityPolicy(capability: Capability): ProjectDiagnostic[] {
  const protectedWithoutPolicy =
    findProperty(capability.definition, 'requiredScopes') !== undefined &&
    findProperty(capability.definition, 'policy') === undefined
  return protectedWithoutPolicy
    ? [
        diagnostic(
          'protected-capability-requires-policy',
          capability.file,
          'protected capability must declare requiredScopes inside policy',
          capability.definition
        )
      ]
    : []
}

function analyzeCapabilityName(
  capability: Capability,
  expectedStyle: CapabilityNameStyle | undefined
): {
  style: CapabilityNameStyle | undefined
  diagnostics: ProjectDiagnostic[]
} {
  const name = propertyString(capability.definition, 'name')
  if (name !== undefined) capability.name = name
  if (name === undefined || !capabilityName.test(name)) {
    return {
      style: expectedStyle,
      diagnostics: [
        diagnostic(
          'capability-name',
          capability.file,
          'capability name must use a stable lowercase kebab-case or snake_case name',
          capability.definition
        )
      ]
    }
  }
  const style = name.includes('_') ? 'snake' : 'kebab'
  const diagnostics =
    expectedStyle !== undefined && expectedStyle !== style
      ? [
          diagnostic(
            'capability-name-style',
            capability.file,
            `capability name "${name}" does not use the project ${expectedStyle}-case style`,
            capability.definition
          )
        ]
      : []
  return { style, diagnostics }
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
