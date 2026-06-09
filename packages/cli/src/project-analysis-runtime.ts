import ts from 'typescript'

import type { ProjectDiagnostic, SourceFile } from './project-analysis-types.js'
import { diagnostic, walk } from './project-analysis-helpers.js'

export function analyzeUnsafeRuntimeCode(
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
