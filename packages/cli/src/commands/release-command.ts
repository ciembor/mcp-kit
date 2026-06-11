import { getBoolean } from '../cli-args.js'
import {
  exitCodes,
  type CliResult,
  type PackageManager,
  type ParsedArgs
} from '../cli-contracts.js'
import { CliError } from '../cli-error.js'
import { detectPackageManager, detectProjectRoot } from '../cli-files.js'
import { runQuality } from '../quality.js'
import { executeCommand } from '../quality/quality-execute.js'

type ReleaseDependencies = {
  runQuality?: typeof runQuality
  execute?: typeof executeCommand
}

export async function prepareRelease(
  parsed: ParsedArgs,
  cwd: string,
  dependencies: ReleaseDependencies = {}
): Promise<CliResult> {
  const unsupportedOptions = Object.keys(parsed.options).filter(
    (option) => option !== 'json' && option !== 'publish'
  )
  if (parsed.positionals.length > 0 || unsupportedOptions.length > 0) {
    throw new CliError('Usage: mcp-kit release [--publish]', exitCodes.usage)
  }

  const root = await detectProjectRoot(cwd, false)
  const publish = getBoolean(parsed, 'publish')
  const controller = new AbortController()
  const interrupt = () => controller.abort()
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)

  const started = performance.now()
  try {
    const qualityRunner = dependencies.runQuality ?? runQuality
    const commandExecutor = dependencies.execute ?? executeCommand
    const quality = await qualityRunner({
      root,
      mode: 'release',
      signal: controller.signal
    })
    if (quality.status !== 'passed') {
      return {
        command: 'release',
        root,
        quality,
        release: {
          status: 'failed',
          durationMs: Math.round(performance.now() - started)
        },
        exitCode: exitCodes.validation
      }
    }

    if (!publish) {
      return {
        command: 'release',
        root,
        quality,
        release: {
          status: 'prepared',
          durationMs: Math.round(performance.now() - started)
        },
        exitCode: exitCodes.ok
      }
    }

    const publishCommand = releasePublishCommand(detectPackageManager(root))
    const publishExitCode = await commandExecutor(publishCommand, {
      cwd: root,
      signal: controller.signal
    })
    return {
      command: 'release',
      root,
      quality,
      release: {
        status: publishExitCode === 0 ? 'published' : 'failed',
        durationMs: Math.round(performance.now() - started)
      },
      exitCode: publishExitCode === 0 ? exitCodes.ok : exitCodes.validation
    }
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
  }
}

function releasePublishCommand(packageManager: PackageManager): string {
  switch (packageManager) {
    case 'pnpm':
      return 'corepack pnpm publish -r --access public --provenance'
    case 'npm':
    case 'yarn':
    case 'bun':
      return 'npm publish --workspaces --access public --provenance'
  }
}
