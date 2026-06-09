import { analyzeImports } from './project-analysis-imports.js'
import { readSourceFiles } from './project-analysis-files.js'
import {
  analyzeCapabilities,
  analyzePorts,
  analyzeRegistry
} from './project-analysis-rules.js'
import { analyzeUnsafeRuntimeCode } from './project-analysis-runtime.js'
import { compareDiagnostics } from './project-analysis-helpers.js'
import type { ProjectAnalysis } from './project-analysis-types.js'

export type {
  ProjectAnalysis,
  ProjectDiagnostic
} from './project-analysis-types.js'

export async function analyzeProject(root: string): Promise<ProjectAnalysis> {
  const files = await readSourceFiles(root)
  const diagnostics = [
    ...analyzeImports(files),
    ...analyzePorts(files),
    ...analyzeCapabilities(files),
    ...analyzeRegistry(files),
    ...analyzeUnsafeRuntimeCode(files)
  ].sort(compareDiagnostics)
  return {
    diagnostics,
    files: files.map((file) => file.path).sort()
  }
}
