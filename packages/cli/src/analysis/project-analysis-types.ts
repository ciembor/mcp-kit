import ts from 'typescript'

export type ProjectDiagnostic = {
  rule: string
  file: string
  line?: number
  message: string
}

export type ProjectAnalysis = {
  diagnostics: readonly ProjectDiagnostic[]
  files: readonly string[]
}

export type SourceFile = {
  path: string
  absolute: string
  source: ts.SourceFile
}

export type Capability = {
  kind: 'tool' | 'resource' | 'prompt'
  name?: string
  file: SourceFile
  definition: ts.ObjectLiteralExpression
}
