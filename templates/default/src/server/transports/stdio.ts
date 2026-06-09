import { runStdio } from '@mcp-kit/node'

import { app } from '../../app.js'

export async function startStdio(): Promise<void> {
  await runStdio(app)
}
