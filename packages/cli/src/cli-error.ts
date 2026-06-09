import type { ExitCode } from './cli-contracts.js'

export class CliError extends Error {
  readonly exitCode: ExitCode

  constructor(message: string, exitCode: ExitCode) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}
