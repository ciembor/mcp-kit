import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { trackProtocolVersion } from '../runtime.js'
import type { McpApp } from './contracts.js'
import { assertNotConnected } from './state.js'

export function lifecycleMethods(runtime: {
  sdk: McpServer
  subscriptions: ReadonlySet<string>
  connected(): boolean
  setConnected(value: boolean): void
  setProtocolVersion(value: string): void
}): Pick<
  McpApp<unknown>,
  'connect' | 'close' | 'notifyResourceListChanged' | 'notifyResourceUpdated'
> {
  return {
    async connect(transport) {
      assertNotConnected(runtime.connected())
      runtime.setConnected(true)
      try {
        await runtime.sdk.connect(
          trackProtocolVersion(transport, (version) =>
            runtime.setProtocolVersion(version)
          )
        )
      } catch (error) {
        runtime.setConnected(false)
        throw error
      }
    },
    async close() {
      await runtime.sdk.close()
      runtime.setConnected(false)
    },
    async notifyResourceListChanged() {
      await runtime.sdk.server.sendResourceListChanged()
    },
    async notifyResourceUpdated(uri) {
      if (runtime.subscriptions.has(uri)) {
        await runtime.sdk.server.sendResourceUpdated({ uri })
      }
    }
  }
}
