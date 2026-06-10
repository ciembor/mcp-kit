import ts from 'typescript'

import type { ProjectDiagnostic, SourceFile } from './project-analysis-types.js'

export function featureName(path: string): string | undefined {
  return /^src\/features\/([^/]+)\//.exec(path)?.[1]
}

export function featureLayer(
  path: string
): { feature: string; layer: string } | undefined {
  const match =
    /^src\/features\/([^/]+)\/(domain|application|mcp|infrastructure)(?:\/|$)/.exec(
      path
    )
  if (match === null) return undefined
  return { feature: match[1]!, layer: match[2]! }
}

export function isFeatureIndex(path: string, feature: string): boolean {
  return new RegExp(
    `^src/features/${escapeRegex(feature)}/index\\.[cm]?[jt]sx?$`
  ).test(path)
}

export function isCompositionRoot(path: string): boolean {
  return /^src\/(?:app|main|composition-root)\.[cm]?[jt]sx?$/.test(path)
}

export function findProperty(
  object: ts.ObjectLiteralExpression,
  name: string
): ts.ObjectLiteralElementLike | undefined {
  return object.properties.find((property) => propertyName(property) === name)
}

export function propertyObject(
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

export function propertyString(
  object: ts.ObjectLiteralExpression,
  name: string
): string | undefined {
  const property = findProperty(object, name)
  return property !== undefined && ts.isPropertyAssignment(property)
    ? stringLiteralValue(property.initializer)
    : undefined
}

export function propertyBoolean(
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
  if (
    !ts.isPropertyAssignment(property) &&
    !ts.isShorthandPropertyAssignment(property) &&
    !ts.isMethodDeclaration(property) &&
    !ts.isGetAccessorDeclaration(property) &&
    !ts.isSetAccessorDeclaration(property)
  ) {
    return undefined
  }
  const supportsTextName = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.Identifier,
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NumericLiteral
  ])
  if (!supportsTextName.has(property.name.kind)) return undefined
  return (property.name as ts.Identifier | ts.StringLiteral | ts.NumericLiteral)
    .text
}

function stringLiteralValue(node: ts.Node): string | undefined {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined
}

export function hasExportModifier(
  node: ts.Node & { modifiers?: ts.NodeArray<ts.ModifierLike> }
): boolean {
  return (
    node.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
    ) ?? false
  )
}

export function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node)
  node.forEachChild((child) => walk(child, visit))
}

export function diagnostic(
  rule: string,
  file: SourceFile,
  message: string,
  node: ts.Node
): ProjectDiagnostic {
  const position = file.source.getLineAndCharacterOfPosition(node.getStart())
  return { rule, file: file.path, line: position.line + 1, message }
}

export function normalizePath(path: string): string {
  return path.replaceAll('\\', '/')
}

export function compareDiagnostics(
  left: ProjectDiagnostic,
  right: ProjectDiagnostic
): number {
  return (
    compareText(left.file, right.file) ||
    (left.line ?? 0) - (right.line ?? 0) ||
    compareText(left.rule, right.rule)
  )
}

export function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
