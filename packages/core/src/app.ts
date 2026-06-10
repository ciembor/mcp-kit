import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
import { silentLogger } from './runtime.js'
import { capabilityMethods } from './app/capabilities.js'
import { contextFactory } from './app/context.js'
import type { McpApp, McpAppOptions } from './app/contracts.js'
import { lifecycleMethods } from './app/lifecycle.js'
import { createAppState, assertNotConnected } from './app/state.js'

export type { McpApp, McpAppOptions } from './app/contracts.js'

export function createMcpApp<Services>(
  options: McpAppOptions<Services>
): McpApp<Services> {
  const state = createAppState(options)
  const { sdk, tools, prompts, resources, subscriptions } = state
  let connected = false
  let logger = options.logger ?? silentLogger
  let protocolVersion = LATEST_PROTOCOL_VERSION

  const createRequestContext = contextFactory(() => ({
    services: options.services,
    logger,
    sdk,
    protocolVersion
  }))
  const capabilities = capabilityMethods({
    sdk,
    tools,
    prompts,
    resources,
    subscriptions,
    createRequestContext,
    middleware: options.middleware ?? [],
    connected: () => connected,
    logger: () => logger
  })

  const lifecycle = lifecycleMethods({
    sdk,
    subscriptions,
    connected: () => connected,
    setConnected: (value) => {
      connected = value
    },
    setProtocolVersion: (value) => {
      protocolVersion = value
    }
  })
  return {
    sdk,
    get connected() {
      return connected
    },
    ...capabilities,
    ...lifecycle,
    setLogger(nextLogger) {
      assertNotConnected(connected)
      logger = nextLogger
    }
  }
}
