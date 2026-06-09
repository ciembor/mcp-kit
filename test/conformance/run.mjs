import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const scenarios = [
  'server-initialize',
  'ping',
  'tools-list',
  'tools-call-simple-text',
  'tools-call-image',
  'tools-call-audio',
  'tools-call-embedded-resource',
  'tools-call-mixed-content',
  'tools-call-error',
  'tools-call-with-progress',
  'resources-list',
  'resources-read-text',
  'resources-read-binary',
  'resources-templates-read',
  'resources-subscribe',
  'resources-unsubscribe',
  'prompts-list',
  'prompts-get-simple',
  'prompts-get-with-args',
  'prompts-get-embedded-resource',
  'prompts-get-with-image'
]

for (const scenario of scenarios) {
  const { server, lines, url } = await startServer()
  try {
    await run([
      'exec',
      'conformance',
      'server',
      '--url',
      url,
      '--scenario',
      scenario,
      '--output-dir',
      '.conformance-results'
    ])
  } finally {
    server.kill('SIGTERM')
    lines.close()
  }
}

async function startServer() {
  const server = spawn(process.execPath, ['test/conformance/server.mjs'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'inherit']
  })
  const lines = createInterface({ input: server.stdout })
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Conformance server did not start')),
      10_000
    )
    lines.once('line', (line) => {
      clearTimeout(timeout)
      resolve(line)
    })
    server.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`Conformance server exited with code ${code}`))
    })
  })
  return { server, lines, url }
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('corepack', ['pnpm', ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit'
    })
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Conformance scenario failed with code ${code}`))
    })
  })
}
