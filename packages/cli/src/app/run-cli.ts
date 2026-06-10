import { getBoolean, parseArgs } from '../cli-args.js'
import type { CliIo } from '../cli-contracts.js'
import { exitCodes } from '../cli-contracts.js'
import { dispatchCli } from './dispatch.js'
import { normalizeCliError, writeError, writeResult } from './output.js'

export async function runCli(
  args: readonly string[] = process.argv.slice(2),
  io: CliIo = {}
): Promise<number> {
  const stdout = io.stdout ?? process.stdout
  const stderr = io.stderr ?? process.stderr
  const cwd = io.cwd ?? process.cwd()
  const parsed = parseArgs(args)
  const json = getBoolean(parsed, 'json')

  try {
    const result = await dispatchCli(parsed, cwd)
    writeResult(result, { json, stdout, stderr })
    return result.exitCode ?? exitCodes.ok
  } catch (error) {
    const cliError = normalizeCliError(error)
    writeError(cliError, { json, stdout, stderr })
    return cliError.exitCode
  }
}
