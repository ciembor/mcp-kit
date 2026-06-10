import { getBoolean } from '../cli-args.js'
import { detectProjectContext, detectProjectRoot } from '../cli-files.js'
import { collectDoctorDiagnostics } from '../cli-doctor.js'
import type { CliResult, ParsedArgs } from '../cli-contracts.js'

export async function doctorProject(
  parsed: ParsedArgs,
  cwd: string
): Promise<CliResult> {
  const root = await detectProjectRoot(cwd, getBoolean(parsed, 'here'))
  const context = await detectProjectContext(root)
  const diagnostics = await collectDoctorDiagnostics(
    root,
    process.versions.node,
    context.packageManager
  )

  return { command: 'doctor', root, diagnostics }
}
