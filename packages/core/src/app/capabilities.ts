import { getObjectShape } from '@modelcontextprotocol/sdk/server/zod-compat.js'

import type {
  AnyResourceDefinition,
  PromptDefinition,
  RegistryItem,
  Schema,
  ServerRequestContext,
  ToolDefinition
} from '../definitions.js'
import {
  installResourceHandlers,
  registerResources
} from './resource-handlers.js'
import {
  installPromptGetHandler,
  installToolCallHandler
} from './tool-handlers.js'
import { toolConfig } from '../runtime.js'
import type { AppRuntime, McpApp } from './contracts.js'
import { assertNotConnected } from './state.js'

export function capabilityMethods<Services>(
  runtime: AppRuntime<Services>
): Pick<McpApp<Services>, 'tools' | 'resources' | 'prompts'> {
  return {
    tools: (definitions) => registerTools(runtime, definitions),
    resources: (definitions) => registerAppResources(runtime, definitions),
    prompts: (definitions) => registerPrompts(runtime, definitions)
  }
}

function registerTools<Services>(
  runtime: AppRuntime<Services>,
  definitions: readonly ToolDefinition<Schema, Services>[]
): void {
  assertNotConnected(runtime.connected())
  for (const tool of definitions) {
    runtime.tools.set(tool.name, tool)
    /* v8 ignore next 2 -- SDK registration placeholder; calls are handled by installToolCallHandler. */
    runtime.sdk.registerTool(tool.name, toolConfig(tool), () =>
      Promise.resolve({ content: [] })
    )
  }
  installToolCallHandler(runtime)
}

function registerAppResources<Services>(
  runtime: AppRuntime<Services>,
  definitions: readonly RegistryItem[]
): void {
  assertNotConnected(runtime.connected())
  const resources =
    definitions as unknown as readonly AnyResourceDefinition<Services>[]
  runtime.resources.push(...resources)
  const createContext = (extra: ServerRequestContext) =>
    runtime.createRequestContext(extra)
  registerResources(runtime.sdk, resources, createContext)
  installResourceHandlers(
    runtime.sdk,
    runtime.resources,
    runtime.subscriptions,
    createContext
  )
}

function registerPrompts<Services>(
  runtime: AppRuntime<Services>,
  definitions: readonly PromptDefinition<Schema, Services>[]
): void {
  assertNotConnected(runtime.connected())
  for (const prompt of definitions) {
    runtime.prompts.set(prompt.name, prompt)
    runtime.sdk.registerPrompt(
      prompt.name,
      {
        ...(prompt.title === undefined ? {} : { title: prompt.title }),
        ...(prompt.description === undefined
          ? {}
          : { description: prompt.description }),
        argsSchema: getObjectShape(prompt.argsSchema)!
      },
      /* v8 ignore next -- SDK registration placeholder; calls are handled by installPromptGetHandler. */
      () => Promise.resolve({ messages: [] })
    )
  }
  installPromptGetHandler(
    runtime.sdk,
    runtime.prompts,
    (extra) => runtime.createRequestContext(extra),
    () => runtime.logger()
  )
}
