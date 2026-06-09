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
  const diagnostics: ProjectDiagnostic[] = []
  const fromLayer = featureLayer(from.path)
  const targetLayer =
    target === undefined ? undefined : featureLayer(target.path)
  const sdkImport = specifier.startsWith('@modelcontextprotocol/')

  if (
    (fromLayer?.layer === 'domain' || fromLayer?.layer === 'application') &&
    sdkImport
  ) {
    diagnostics.push(
      diagnostic(
        'no-mcp-sdk-in-policy',
        from,
        `${fromLayer.layer} must not import the MCP SDK`,
        node
      )
    )
  }

  if (fromLayer?.layer === 'domain' && target !== undefined) {
    if (
      targetLayer?.feature === fromLayer.feature &&
      targetLayer.layer !== 'domain'
    ) {
      diagnostics.push(
        diagnostic(
          'domain-dependencies',
          from,
          'domain may only depend on its own domain layer',
          node
        )
      )
    }
    if (/^src\/(?:mcp|server)\//.test(target.path)) {
      diagnostics.push(
        diagnostic(
          'domain-dependencies',
          from,
          'domain must not depend on MCP or server adapters',
          node
        )
      )
    }
  }

  if (
    fromLayer?.layer === 'application' &&
    targetLayer?.feature === fromLayer.feature &&
    (targetLayer.layer === 'mcp' || targetLayer.layer === 'infrastructure')
  ) {
    diagnostics.push(
      diagnostic(
        'application-dependencies',
        from,
        'application must not depend on MCP or infrastructure',
        node
      )
    )
  }

  if (
    fromLayer?.layer === 'mcp' &&
    targetLayer?.feature === fromLayer.feature &&
    targetLayer.layer === 'infrastructure'
  ) {
    diagnostics.push(
      diagnostic(
        'mcp-dependencies',
        from,
        'MCP adapters must not depend on infrastructure',
        node
      )
    )
  }

  if (
    fromLayer !== undefined &&
    targetLayer !== undefined &&
    target !== undefined &&
    fromLayer.feature !== targetLayer.feature &&
    !isFeatureIndex(target.path, targetLayer.feature)
  ) {
    diagnostics.push(
      diagnostic(
        'feature-public-boundary',
        from,
        `feature "${fromLayer.feature}" must import feature "${targetLayer.feature}" through its index`,
        node
      )
    )
  }

  if (/^src\/server\//.test(from.path) && targetLayer?.layer === 'domain') {
    diagnostics.push(
      diagnostic(
        'server-dependencies',
        from,
        'server adapters must not import feature domain directly',
        node
      )
    )
  }

  if (
    targetLayer?.layer === 'infrastructure' &&
    !isCompositionRoot(from.path) &&
    fromLayer?.layer !== 'infrastructure'
  ) {
    diagnostics.push(
      diagnostic(
        'infrastructure-wiring',
        from,
        'only infrastructure or the composition root may import infrastructure',
        node
      )
    )
  }
  return diagnostics
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
