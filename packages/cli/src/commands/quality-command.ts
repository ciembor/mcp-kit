import { getBoolean, getString } from '../cli-args.js'
import { exitCodes, type CliResult, type ParsedArgs } from '../cli-contracts.js'
import { CliError } from '../cli-error.js'
import { detectProjectRoot } from '../cli-files.js'
import { runQuality, type QualityMode } from '../quality.js'

export async function qualityProject(
  parsed: ParsedArgs,
  cwd: string
): Promise<CliResult> {
  const fast = getBoolean(parsed, 'fast')
  const full = getBoolean(parsed, 'full')
  const release = getBoolean(parsed, 'release')
  const mutation = getBoolean(parsed, 'mutation')
  const selectedModes = [fast, full, release, mutation].filter(Boolean).length
  if (selectedModes !== 1) {
    throw new CliError(
      'Usage: mcp-kit quality --fast|--full|--release|--mutation',
      exitCodes.usage
    )
  }
  const mode = selectedQualityMode({ fast, full, release })
  const root = await detectProjectRoot(cwd, false)
  const controller = new AbortController()
  const interrupt = () => controller.abort()
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  try {
    const since = getString(parsed, 'since')
    const quality = await runQuality({
      root,
      mode,
      fix: getBoolean(parsed, 'fix'),
      signal: controller.signal,
      ...(since === undefined ? {} : { since })
    })
    return {
      command: 'quality',
      root,
      quality,
      exitCode:
        quality.status === 'passed' ? exitCodes.ok : exitCodes.validation
    }
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
  }
}

function selectedQualityMode(options: {
  fast: boolean
  full: boolean
  release: boolean
}): QualityMode {
  if (options.fast) return 'fast'
  if (options.full) return 'full'
  if (options.release) return 'release'
  return 'mutation'
}
