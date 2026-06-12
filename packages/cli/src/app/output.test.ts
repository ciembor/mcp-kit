import { describe, expect, it } from 'vitest'

import { CliError } from '../cli-error.js'
import { exitCodes } from '../cli-contracts.js'
import { normalizeCliError, writeError, writeResult } from './output.js'

describe('cli output helpers', () => {
  it('normalizes unknown errors into internal CliError instances', () => {
    const cliError = new CliError('invalid', exitCodes.usage)

    expect(normalizeCliError(cliError)).toBe(cliError)
    expect(normalizeCliError('broken')).toMatchObject({
      message: 'broken',
      exitCode: exitCodes.internal
    })
  })

  it('writes release progress and release summary lines', () => {
    const stdout = createWriter()
    const stderr = createWriter()

    writeResult(
      {
        command: 'release',
        root: '/repo',
        exitCode: exitCodes.ok,
        quality: {
          mode: 'release',
          preset: 'off',
          root: '/repo',
          status: 'passed',
          durationMs: 1_250,
          coverage: {
            thresholds: {
              lines: 100,
              functions: 100,
              statements: 100,
              branches: 100
            },
            exclusions: []
          },
          steps: [
            {
              name: 'tests',
              status: 'passed',
              durationMs: 250,
              diagnostics: []
            }
          ]
        },
        release: {
          status: 'published',
          durationMs: 2_500
        }
      },
      {
        json: false,
        stdout,
        stderr
      }
    )

    expect(stderr.output).toBe('')
    expect(stdout.output).toContain('[passed] tests 250ms')
    expect(stdout.output).toContain('quality passed in 1.3s')
    expect(stdout.output).toContain('release published in 2.5s')
  })

  it('writes json and text errors to the correct stream', () => {
    const jsonStdout = createWriter()
    const jsonStderr = createWriter()
    const textStdout = createWriter()
    const textStderr = createWriter()
    const error = new CliError('bad input', exitCodes.validation)

    writeError(error, {
      json: true,
      stdout: jsonStdout,
      stderr: jsonStderr
    })
    writeError(error, {
      json: false,
      stdout: textStdout,
      stderr: textStderr
    })

    expect(jsonStderr.output).toBe('')
    expect(textStdout.output).toBe('')
    expect(JSON.parse(jsonStdout.output)).toEqual({
      ok: false,
      error: { message: 'bad input', exitCode: exitCodes.validation }
    })
    expect(textStderr.output).toBe('mcp-kit: bad input\n')
  })
})

function createWriter() {
  return {
    output: '',
    write(chunk: string) {
      this.output += chunk
      return true
    }
  }
}
