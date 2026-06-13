import { startHttp } from './server/transports/http.js'
import { startStdio } from './server/transports/stdio.js'

const transport = process.env['MCP_TRANSPORT'] ?? 'stdio'

if (transport === 'http') {
  await startHttp()
} else if (transport === 'stdio') {
  await startStdio()
} else {
  throw new Error(`Unsupported MCP_TRANSPORT: ${transport}`)
}
