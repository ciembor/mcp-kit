import { resolve } from 'node:path'
import ts from 'typescript'

import type { ProjectDiagnostic, SourceFile } from './project-analysis-types.js'
import {
  diagnostic,
  featureLayer,
  featureName,
  isCompositionRoot,
  isFeatureIndex
} from './project-analysis-helpers.js'

export function analyzeImports(
  files: readonly SourceFile[]
): ProjectDiagnostic[] {
  const diagnostics: ProjectDiagnostic[] = []
  const graph = new Map<string, string[]>()
  const byAbsolute = new Map(files.map((file) => [file.absolute, file]))

  for (const file of files) {
    const imports: string[] = []
    for (const statement of file.source.statements) {
      if (!ts.isImportDeclaration(statement)) continue
      const specifier = (statement.moduleSpecifier as ts.StringLiteral).text
      const target = resolveImport(file.absolute, specifier, byAbsolute)
      if (target !== undefined) imports.push(target.absolute)
      diagnostics.push(
        ...validateImport(file, target, specifier, statement.moduleSpecifier)
      )
    }
    graph.set(file.absolute, imports)
  }

  diagnostics.push(...findCycles(files, graph))
  diagnostics.push(...requireFeatureIndexes(files))
  return diagnostics
}

function validateImport(
  from: SourceFile,
  target: SourceFile | undefined,
  specifier: string,
  node: ts.Node
): ProjectDiagnostic[] {
  const context: ImportContext = {
    from,
    target,
    specifier,
    node,
    fromLayer: featureLayer(from.path),
    targetLayer: target === undefined ? undefined : featureLayer(target.path)
  }
  return importRules.flatMap((rule) => rule(context) ?? [])
}

type ImportContext = {
  from: SourceFile
  target: SourceFile | undefined
  specifier: string
  node: ts.Node
  fromLayer: ReturnType<typeof featureLayer>
  targetLayer: ReturnType<typeof featureLayer>
}

type ImportRule = (context: ImportContext) => ProjectDiagnostic | undefined

function importDiagnostic(
  context: ImportContext,
  rule: string,
  message: string
): ProjectDiagnostic {
  return diagnostic(rule, context.from, message, context.node)
}

const importRules: readonly ImportRule[] = [
  (context) => {
    const policyLayer =
      context.fromLayer?.layer === 'domain' ||
      context.fromLayer?.layer === 'application'
    if (
      !policyLayer ||
      !context.specifier.startsWith('@modelcontextprotocol/')
    ) {
      return undefined
    }
    return importDiagnostic(
      context,
      'no-mcp-sdk-in-policy',
      `${context.fromLayer!.layer} must not import the MCP SDK`
    )
  },
  (context) => {
    const invalid =
      context.fromLayer?.layer === 'domain' &&
      context.targetLayer?.feature === context.fromLayer.feature &&
      context.targetLayer.layer !== 'domain'
    return invalid
      ? importDiagnostic(
          context,
          'domain-dependencies',
          'domain may only depend on its own domain layer'
        )
      : undefined
  },
  (context) => {
    const invalid =
      context.fromLayer?.layer === 'domain' &&
      context.target !== undefined &&
      /^src\/(?:mcp|server)\//.test(context.target.path)
    return invalid
      ? importDiagnostic(
          context,
          'domain-dependencies',
          'domain must not depend on MCP or server adapters'
        )
      : undefined
  },
  (context) => {
    const invalid =
      context.fromLayer?.layer === 'application' &&
      context.targetLayer?.feature === context.fromLayer.feature &&
      ['mcp', 'infrastructure'].includes(context.targetLayer.layer)
    return invalid
      ? importDiagnostic(
          context,
          'application-dependencies',
          'application must not depend on MCP or infrastructure'
        )
      : undefined
  },
  (context) => {
    const invalid =
      context.fromLayer?.layer === 'mcp' &&
      context.targetLayer?.feature === context.fromLayer.feature &&
      context.targetLayer.layer === 'infrastructure'
    return invalid
      ? importDiagnostic(
          context,
          'mcp-dependencies',
          'MCP adapters must not depend on infrastructure'
        )
      : undefined
  },
  featureBoundaryDiagnostic,
  (context) =>
    /^src\/server\//.test(context.from.path) &&
    context.targetLayer?.layer === 'domain'
      ? importDiagnostic(
          context,
          'server-dependencies',
          'server adapters must not import feature domain directly'
        )
      : undefined,
  (context) => {
    const invalid =
      context.targetLayer?.layer === 'infrastructure' &&
      !isCompositionRoot(context.from.path) &&
      context.fromLayer?.layer !== 'infrastructure'
    return invalid
      ? importDiagnostic(
          context,
          'infrastructure-wiring',
          'only infrastructure or the composition root may import infrastructure'
        )
      : undefined
  }
]

function featureBoundaryDiagnostic(
  context: ImportContext
): ProjectDiagnostic | undefined {
  const { fromLayer, targetLayer, target } = context
  const crossesPrivateBoundary =
    fromLayer !== undefined &&
    targetLayer !== undefined &&
    target !== undefined &&
    fromLayer.feature !== targetLayer.feature &&
    !isFeatureIndex(target.path, targetLayer.feature)
  if (!crossesPrivateBoundary) return undefined
  return importDiagnostic(
    context,
    'feature-public-boundary',
    `feature "${fromLayer.feature}" must import feature "${targetLayer.feature}" through its index`
  )
}

function findCycles(
  files: readonly SourceFile[],
  graph: ReadonlyMap<string, readonly string[]>
): ProjectDiagnostic[] {
  const diagnostics: ProjectDiagnostic[] = []
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const byAbsolute = new Map(files.map((file) => [file.absolute, file]))

  function visit(path: string, trail: readonly string[]): void {
    if (visiting.has(path)) {
      const start = trail.indexOf(path)
      const cycle = [...trail.slice(start), path]
      const file = byAbsolute.get(path)!
      diagnostics.push({
        rule: 'no-circular-dependencies',
        file: file.path,
        message: `dependency cycle: ${cycle
          .map((item) => byAbsolute.get(item)!.path)
          .join(' -> ')}`
      })
      return
    }
    if (visited.has(path)) return
    visiting.add(path)
    for (const dependency of graph.get(path)!) {
      visit(dependency, [...trail, path])
    }
    visiting.delete(path)
    visited.add(path)
  }

  for (const file of files) visit(file.absolute, [])
  return diagnostics
}

function requireFeatureIndexes(
  files: readonly SourceFile[]
): ProjectDiagnostic[] {
  const features = new Map<string, SourceFile>()
  const indexes = new Set<string>()
  for (const file of files) {
    const feature = featureName(file.path)
    if (feature === undefined) continue
    features.set(feature, file)
    if (isFeatureIndex(file.path, feature)) indexes.add(feature)
  }
  return [...features.entries()]
    .filter(([feature]) => !indexes.has(feature))
    .map(([feature]) => ({
      rule: 'feature-public-boundary',
      file: `src/features/${feature}/index.ts`,
      message: `feature "${feature}" must define an index.ts or index.js public boundary`
    }))
}

function resolveImport(
  from: string,
  specifier: string,
  files: ReadonlyMap<string, SourceFile>
): SourceFile | undefined {
  if (!specifier.startsWith('.')) return undefined
  const base = resolve(from, '..', specifier)
  const candidates = [
    base,
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.mjs$/, '.mts'),
    base.replace(/\.cjs$/, '.cts'),
    `${base}.ts`,
    `${base}.js`,
    resolve(base, 'index.ts'),
    resolve(base, 'index.js')
  ]
  return candidates.map((candidate) => files.get(candidate)).find(Boolean)
}
