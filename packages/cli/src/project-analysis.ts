import { readdir, readFile } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'

import * as ts from 'typescript'

export type ProjectDiagnostic = {
  rule: string
  file: string
  message: string
  line?: number
}

export type ProjectAnalysis = {
  diagnostics: readonly ProjectDiagnostic[]
  files: readonly string[]
}

type SourceFile = {
  absolute: string
  path: string
  source: ts.SourceFile
}

type Capability = {
  file: SourceFile
  kind: 'tool' | 'resource' | 'prompt'
  name?: string
  definition: ts.ObjectLiteralExpression
}

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const capabilityName = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/

export async function analyzeProject(root: string): Promise<ProjectAnalysis> {
  const sourceRoot = resolve(root, 'src')
  const files = await readSourceFiles(sourceRoot, root)
  const diagnostics = [
    ...analyzeImports(files),
    ...analyzePorts(files),
    ...analyzeCapabilities(files),
    ...analyzeRegistry(files),
    ...analyzeUnsafeRuntimeCode(files)
  ]
  return {
    files: files.map((file) => file.path),
    diagnostics: diagnostics.sort(compareDiagnostics)
  }
}

async function readSourceFiles(
  directory: string,
  root: string
): Promise<SourceFile[]> {
  const files: SourceFile[] = []
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return files
    throw error
  }
  for (const entry of entries) {
    const absolute = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await readSourceFiles(absolute, root)))
      continue
    }
    if (!sourceExtensions.has(extname(entry.name))) continue
    const content = await readFile(absolute, 'utf8')
    files.push({
      absolute,
      path: normalizePath(relative(root, absolute)),
      source: ts.createSourceFile(
        absolute,
        content,
        ts.ScriptTarget.Latest,
        true,
        scriptKind(absolute)
      )
    })
  }
  return files
}

function analyzeImports(files: readonly SourceFile[]): ProjectDiagnostic[] {
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

function analyzePorts(files: readonly SourceFile[]): ProjectDiagnostic[] {
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

function analyzeCapabilities(
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

function analyzeRegistry(files: readonly SourceFile[]): ProjectDiagnostic[] {
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
      if (argument === undefined || !ts.isArrayLiteralExpression(argument))
        return
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

function analyzeUnsafeRuntimeCode(
  files: readonly SourceFile[]
): ProjectDiagnostic[] {
  const diagnostics: ProjectDiagnostic[] = []
  for (const file of files) {
    walk(file.source, (node) => {
      if (
        /src\/server\/transports\/stdio\.[cm]?[jt]s$/.test(file.path) &&
        ts.isCallExpression(node) &&
        (node.expression.getText() === 'console.log' ||
          node.expression.getText() === 'process.stdout.write')
      ) {
        diagnostics.push(
          diagnostic(
            'no-console-log-in-stdio',
            file,
            'stdio transport must not write application output to stdout',
            node
          )
        )
      }
      if (
        ts.isPropertyAccessExpression(node) &&
        node.name.text === 'stack' &&
        !file.path.endsWith('.test.ts')
      ) {
        diagnostics.push(
          diagnostic(
            'no-raw-error-stack',
            file,
            'raw error stacks must not be exposed',
            node
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

function featureName(path: string): string | undefined {
  return /^src\/features\/([^/]+)\//.exec(path)?.[1]
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

function featureLayer(
  path: string
): { feature: string; layer: string } | undefined {
  const match =
    /^src\/features\/([^/]+)\/(domain|application|mcp|infrastructure)(?:\/|$)/.exec(
      path
    )
  if (match === null) return undefined
  return { feature: match[1]!, layer: match[2]! }
}

function isFeatureIndex(path: string, feature: string): boolean {
  return new RegExp(
    `^src/features/${escapeRegex(feature)}/index\\.[cm]?[jt]sx?$`
  ).test(path)
}

function isCompositionRoot(path: string): boolean {
  return /^src\/(?:app|main|composition-root)\.[cm]?[jt]sx?$/.test(path)
}

function findProperty(
  object: ts.ObjectLiteralExpression,
  name: string
): ts.ObjectLiteralElementLike | undefined {
  return object.properties.find((property) => propertyName(property) === name)
}

function propertyObject(
  object: ts.ObjectLiteralExpression,
  name: string
): ts.ObjectLiteralExpression | undefined {
  const property = findProperty(object, name)
  return property !== undefined &&
    ts.isPropertyAssignment(property) &&
    ts.isObjectLiteralExpression(property.initializer)
    ? property.initializer
    : undefined
}

function propertyString(
  object: ts.ObjectLiteralExpression,
  name: string
): string | undefined {
  const property = findProperty(object, name)
  return property !== undefined && ts.isPropertyAssignment(property)
    ? stringLiteralValue(property.initializer)
    : undefined
}

function propertyBoolean(
  object: ts.ObjectLiteralExpression | undefined,
  name: string
): boolean | undefined {
  if (object === undefined) return undefined
  const property = findProperty(object, name)
  if (property === undefined || !ts.isPropertyAssignment(property)) {
    return undefined
  }
  if (property.initializer.kind === ts.SyntaxKind.TrueKeyword) return true
  if (property.initializer.kind === ts.SyntaxKind.FalseKeyword) return false
  return undefined
}

function propertyName(
  property: ts.ObjectLiteralElementLike
): string | undefined {
  if (!('name' in property) || property.name === undefined) return undefined
  return ts.isIdentifier(property.name) ||
    ts.isStringLiteral(property.name) ||
    ts.isNumericLiteral(property.name)
    ? property.name.text
    : undefined
}

function stringLiteralValue(node: ts.Node): string | undefined {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined
}

function hasExportModifier(
  node: ts.Node & { modifiers?: ts.NodeArray<ts.ModifierLike> }
): boolean {
  return (
    node.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
    ) ?? false
  )
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node)
  node.forEachChild((child) => walk(child, visit))
}

function diagnostic(
  rule: string,
  file: SourceFile,
  message: string,
  node: ts.Node
): ProjectDiagnostic {
  const position = file.source.getLineAndCharacterOfPosition(node.getStart())
  return { rule, file: file.path, message, line: position.line + 1 }
}

function scriptKind(path: string): ts.ScriptKind {
  switch (extname(path)) {
    case '.js':
    case '.mjs':
    case '.cjs':
      return ts.ScriptKind.JS
    case '.jsx':
      return ts.ScriptKind.JSX
    case '.tsx':
      return ts.ScriptKind.TSX
    default:
      return ts.ScriptKind.TS
  }
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/')
}

function compareDiagnostics(
  left: ProjectDiagnostic,
  right: ProjectDiagnostic
): number {
  return (
    compareText(left.file, right.file) ||
    (left.line ?? 0) - (right.line ?? 0) ||
    compareText(left.rule, right.rule)
  )
}

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
