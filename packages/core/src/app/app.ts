import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
import { silentLogger } from '../runtime.js'
import { resolveRuntimePolicyStores } from '../runtime/tool-runtime-policy.js'
import { capabilityMethods } from './capabilities.js'
import { contextFactory } from './context.js'
import type { McpApp, McpAppOptions } from './contracts.js'
import { lifecycleMethods } from './lifecycle.js'
import { createAppState, assertNotConnected } from './state.js'

export type { McpApp, McpAppOptions } from './contracts.js'

export function createMcpApp<Services>(
  options: McpAppOptions<Services>
): McpApp<Services> {
  const state = createAppState(options)
  const { sdk, tools, prompts, resources, subscriptions } = state
  let connected = false
  let logger = options.logger ?? silentLogger
  let protocolVersion = LATEST_PROTOCOL_VERSION
  const policyStores = resolveRuntimePolicyStores(options.policyStores)

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
    middlewarePhases: options.middlewarePhases ?? {},
    policyStores,
    observability: options.observability,
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
