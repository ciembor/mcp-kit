import { spawn } from 'node:child_process'

export async function executeCommand(
  command: string,
  options: { cwd: string; signal: AbortSignal }
): Promise<number> {
  const [program, ...args] = commandArguments(command)
  if (program === undefined) return 70
  return new Promise((resolvePromise) => {
    const child = spawn(program, args, {
      cwd: options.cwd,
      stdio: 'inherit'
    })
    const abort = () => child.kill('SIGTERM')
    options.signal.addEventListener('abort', abort, { once: true })
    child.once('error', () => resolvePromise(70))
    child.once('exit', (code, signal) => {
      options.signal.removeEventListener('abort', abort)
      if (code !== null) {
        resolvePromise(code)
        return
      }
      const signalExitCodes = { SIGINT: 130, SIGTERM: 143 } as const
      resolvePromise(
        signal === 'SIGINT' || signal === 'SIGTERM'
          ? signalExitCodes[signal]
          : 70
      )
    })
  })
}

function commandArguments(command: string): string[] {
  const tokens = command.match(/(?:[^\s'"]+|'[^']*'|"[^"]*")+/g) ?? []
  return tokens.map((token) => {
    const quoted =
      (token.startsWith("'") && token.endsWith("'")) ||
      (token.startsWith('"') && token.endsWith('"'))
    return quoted ? token.slice(1, -1) : token
  })
}
