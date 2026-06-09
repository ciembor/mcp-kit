import { spawn } from 'node:child_process'

export async function executeCommand(
  command: string,
  options: { cwd: string; signal: AbortSignal }
): Promise<number> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, {
      cwd: options.cwd,
      shell: true,
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
