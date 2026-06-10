import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import {
  compareDiagnostics,
  compareText,
  diagnostic,
  featureLayer,
  featureName,
  findProperty,
  hasExportModifier,
  isCompositionRoot,
  isFeatureIndex,
  normalizePath,
  propertyBoolean,
  propertyObject,
  propertyString,
  walk
} from './project-analysis-helpers.js'
import type { ProjectDiagnostic } from './project-analysis-types.js'

function objectLiteral(sourceText: string): ts.ObjectLiteralExpression {
  const source = ts.createSourceFile(
    'fixture.ts',
    `const value = ${sourceText}`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  const statement = source.statements[0]
  if (statement === undefined || !ts.isVariableStatement(statement)) {
    throw new Error('expected object literal fixture')
  }
  const declaration = statement.declarationList.declarations[0]
  if (
    declaration === undefined ||
    declaration.initializer === undefined ||
    !ts.isObjectLiteralExpression(declaration.initializer)
  ) {
    throw new Error('expected object literal fixture')
  }
  return declaration.initializer
}

function fixtureVariable(sourceText: string): ts.VariableDeclaration {
  const source = ts.createSourceFile(
    'fixture.ts',
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  const statement = source.statements[0]
  if (statement === undefined || !ts.isVariableStatement(statement)) {
    throw new Error('expected variable declaration fixture')
  }
  const declaration = statement.declarationList.declarations[0]
  if (declaration === undefined) {
    throw new Error('expected variable declaration fixture')
  }
  return declaration
}

describe('project analysis helpers', () => {
  it('derives feature names and layers only from feature paths', () => {
    expect(featureName('src/features/orders/application/use-case.ts')).toBe(
      'orders'
    )
    expect(featureName('src/features/o/domain/entity.ts')).toBe('o')
    expect(featureName('nested/src/features/orders/index.ts')).toBeUndefined()
    expect(featureName('other/features/orders/index.ts')).toBeUndefined()
    expect(featureName('src/features/orders')).toBeUndefined()

    expect(
      featureLayer('src/features/orders/infrastructure/adapter.ts')
    ).toEqual({
      feature: 'orders',
      layer: 'infrastructure'
    })
    expect(featureLayer('src/features/orders/mcp')).toEqual({
      feature: 'orders',
      layer: 'mcp'
    })
    expect(featureLayer('src/features/orders/test/helper.ts')).toBeUndefined()
    expect(featureLayer('nested/src/features/orders/domain/entity.ts')).toBe(
      undefined
    )
  })

  it('matches feature indexes and composition roots by supported extensions', () => {
    expect(isFeatureIndex('src/features/orders/index.ts', 'orders')).toBe(true)
    expect(isFeatureIndex('src/features/orders/index.mts', 'orders')).toBe(true)
    expect(isFeatureIndex('src/features/orders/index.jsx', 'orders')).toBe(true)
    expect(isFeatureIndex('src/features/orders/index.ts', 'orders.test')).toBe(
      false
    )
    expect(isFeatureIndex('src/features/order(s)/index.ts', 'order(s)')).toBe(
      true
    )
    expect(
      isFeatureIndex('src/features/order(s)/index.tsx.map', 'order(s)')
    ).toBe(false)

    expect(isCompositionRoot('src/app.ts')).toBe(true)
    expect(isCompositionRoot('src/main.mjs')).toBe(true)
    expect(isCompositionRoot('src/composition-root.cjs')).toBe(true)
    expect(isCompositionRoot('src/app.ts.bak')).toBe(false)
    expect(isCompositionRoot('nested/src/main.ts')).toBe(false)
    expect(isCompositionRoot('src/root.ts')).toBe(false)
  })

  it('reads typed properties from object literals', () => {
    const object = objectLiteral(`{
      policy: { effects: \`read\` },
      quoted: "tool",
      enabled: true,
      disabled: false,
      count: 1,
      nested: {}
    }`)

    expect(findProperty(object, 'quoted')).toBeDefined()
    expect(findProperty(object, 'missing')).toBeUndefined()
    const policy = propertyObject(object, 'policy')
    expect(policy).toBeDefined()
    expect(policy?.properties.length).toBe(1)
    expect(propertyObject(object, 'quoted')).toBeUndefined()
    expect(propertyString(object, 'quoted')).toBe('tool')
    expect(propertyString(object, 'missing')).toBeUndefined()
    expect(propertyString(object, 'policy')).toBeUndefined()
    expect(propertyString(object, 'count')).toBeUndefined()
    expect(propertyBoolean(object, 'enabled')).toBe(true)
    expect(propertyBoolean(object, 'disabled')).toBe(false)
    expect(propertyBoolean(object, 'quoted')).toBeUndefined()
    expect(propertyBoolean(object, 'count')).toBeUndefined()
    expect(propertyBoolean(undefined, 'enabled')).toBeUndefined()
  })

  it('handles computed and non-assignment properties conservatively', () => {
    const object = objectLiteral(`{
      ['dynamic']: true,
      1n: "big",
      ...{},
      method() { return true },
      get value() { return 'x' },
      5: "five"
    }`)

    expect(findProperty(object, 'dynamic')).toBeUndefined()
    expect(findProperty(object, '1n')).toBeUndefined()
    expect(findProperty(object, 'missing')).toBeUndefined()
    expect(findProperty(object, 'method')).toBeDefined()
    expect(propertyString(object, 'dynamic')).toBeUndefined()
    expect(propertyString(object, '1n')).toBeUndefined()
    expect(propertyString(object, 'method')).toBeUndefined()
    expect(propertyString(object, 'value')).toBeUndefined()
    expect(propertyString(object, '5')).toBe('five')
  })

  it('detects export modifiers and walks every child node', () => {
    const source = ts.createSourceFile(
      'fixture.ts',
      'export const value = { nested: true }\nconst hidden = 1\n',
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    )

    expect(hasExportModifier(source.statements[0]!)).toBe(true)
    expect(hasExportModifier(source.statements[1]!)).toBe(false)
    expect(hasExportModifier(source)).toBe(false)

    const withDeclare = ts.createSourceFile(
      'declare.ts',
      'declare class Hidden {}\nexport default class Visible {}\n',
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    )
    expect(hasExportModifier(withDeclare.statements[0]!)).toBe(false)
    expect(hasExportModifier(withDeclare.statements[1]!)).toBe(true)

    const kinds: ts.SyntaxKind[] = []
    walk(source, (node) => kinds.push(node.kind))
    expect(kinds[0]).toBe(ts.SyntaxKind.SourceFile)
    expect(kinds).toContain(ts.SyntaxKind.TrueKeyword)
    expect(kinds).toContain(ts.SyntaxKind.Identifier)
  })

  it('accepts concrete nodes in helper fixtures', () => {
    const declaration = fixtureVariable('const value = 1\n')

    expect(hasExportModifier(declaration)).toBe(false)
  })

  it('builds diagnostics, normalizes paths and sorts deterministically', () => {
    const source = ts.createSourceFile(
      'src\\feature.ts',
      'const first = 1\nconst second = 2\n',
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    )
    const statement = source.statements[1]
    if (statement === undefined) throw new Error('expected second statement')

    expect(
      diagnostic(
        'rule',
        { path: 'src\\feature.ts', absolute: '/tmp/src\\feature.ts', source },
        'message',
        statement
      )
    ).toEqual({
      rule: 'rule',
      file: 'src\\feature.ts',
      line: 2,
      message: 'message'
    })

    expect(normalizePath('src\\features\\orders\\index.ts')).toBe(
      'src/features/orders/index.ts'
    )

    expect(compareText('a', 'b')).toBe(-1)
    expect(compareText('b', 'a')).toBe(1)
    expect(compareText('a', 'a')).toBe(0)

    const diagnostics: ProjectDiagnostic[] = [
      { file: 'src/b.ts', line: 1, rule: 'b', message: 'b' },
      { file: 'src/a.ts', line: 3, rule: 'z', message: 'z' },
      { file: 'src/a.ts', line: 2, rule: 'a', message: 'a' },
      { file: 'src/a.ts', rule: 'b', message: 'b' },
      { file: 'src/a.ts', line: 2, rule: 'c', message: 'c' }
    ]
    expect([...diagnostics].sort(compareDiagnostics)).toEqual([
      { file: 'src/a.ts', rule: 'b', message: 'b' },
      { file: 'src/a.ts', line: 2, rule: 'a', message: 'a' },
      { file: 'src/a.ts', line: 2, rule: 'c', message: 'c' },
      { file: 'src/a.ts', line: 3, rule: 'z', message: 'z' },
      { file: 'src/b.ts', line: 1, rule: 'b', message: 'b' }
    ])
  })
})
