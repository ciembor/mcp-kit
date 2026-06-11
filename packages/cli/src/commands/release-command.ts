import { exitCodes, type CliResult, type ParsedArgs } from '../cli-contracts.js'
import { CliError } from '../cli-error.js'
import { detectProjectRoot } from '../cli-files.js'
import { runQuality } from '../quality.js'

export async function prepareRelease(
  parsed: ParsedArgs,
  cwd: string
): Promise<CliResult> {
  const unsupportedOptions = Object.keys(parsed.options).filter(
    (option) => option !== 'json'
  )
  if (parsed.positionals.length > 0 || unsupportedOptions.length > 0) {
    throw new CliError('Usage: mcp-kit release', exitCodes.usage)
  }

  const root = await detectProjectRoot(cwd, false)
  const controller = new AbortController()
  const interrupt = () => controller.abort()
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)

  const started = performance.now()
  try {
    const quality = await runQuality({
      root,
      mode: 'release',
      signal: controller.signal
    })
    const prepared = quality.status === 'passed'
    return {
      command: 'release',
      root,
      quality,
      release: {
        status: prepared ? 'prepared' : 'failed',
        durationMs: Math.round(performance.now() - started)
      },
      exitCode: prepared ? exitCodes.ok : exitCodes.validation
    }
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
  }
}
