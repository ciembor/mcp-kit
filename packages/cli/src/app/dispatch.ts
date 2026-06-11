import {
  addCapability,
  createNewProject,
  doctorProject,
  initProject,
  prepareRelease,
  qualityProject
} from '../cli-commands.js'
import { exitCodes, type CliResult, type ParsedArgs } from '../cli-contracts.js'
import { CliError } from '../cli-error.js'

export async function dispatchCli(
  parsed: ParsedArgs,
  cwd: string
): Promise<CliResult> {
  const command = parsed.command
  const handlers: Record<string, () => Promise<CliResult>> = {
    new: () => createNewProject(parsed, cwd),
    init: () => initProject(parsed, cwd),
    add: () => addCapability(parsed, cwd),
    doctor: () => doctorProject(parsed, cwd),
    quality: () => qualityProject(parsed, cwd),
    release: () => prepareRelease(parsed, cwd)
  }
  if (command === undefined || ['help', '--help', '-h'].includes(command)) {
    return { command: 'help' }
  }
  const handler = handlers[command]
  if (handler !== undefined) return handler()
  throw new CliError(
    `Unknown command "${command}". Expected new, init, add, doctor, quality or release.`,
    exitCodes.usage
  )
}
