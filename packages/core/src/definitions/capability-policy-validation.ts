import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'

import type { Schema, ToolPolicy } from './contracts.js'
import { validateInputPolicy } from './capability-input-policy-validation.js'

export function validateToolPolicy(definition: {
  name: string
  outputSchema?: Schema
  annotations?: ToolAnnotations
  policy?: ToolPolicy
}): void {
  validateReadOnlyHint(definition)
  validateDestructiveHint(definition)
  validateOutputPolicy(definition)
  validateOutboundHttpPolicy(definition)
  validateNumericToolPolicy(definition)
  validateAllowHosts(
    definition.name,
    'policy.outboundHttp.allowHosts',
    definition.policy?.outboundHttp?.allowHosts
  )
  validateInputPolicy(definition.name, definition.policy?.input)
}

function validateReadOnlyHint(definition: {
  name: string
  annotations?: ToolAnnotations
  policy?: ToolPolicy
}): void {
  const invalidHint =
    definition.policy?.effects === 'read'
      ? definition.annotations?.readOnlyHint === false
      : definition.policy?.effects === 'write' &&
        definition.annotations?.readOnlyHint === true
  if (!invalidHint) return
  throw new Error(
    `Tool "${definition.name}" has ${definition.policy!.effects} effects but readOnlyHint is ${String(definition.annotations!.readOnlyHint)}`
  )
}

function validateDestructiveHint(definition: {
  name: string
  annotations?: ToolAnnotations
  policy?: ToolPolicy
}): void {
  assertDestructiveHintHasPolicy(definition)
  assertDestructivePolicyRequiresWrite(definition)
  assertDestructivePolicyDeclaresHint(definition)
}

function assertDestructiveHintHasPolicy(definition: {
  name: string
  annotations?: ToolAnnotations
  policy?: ToolPolicy
}): void {
  if (
    definition.annotations?.destructiveHint !== true ||
    definition.policy?.destructive !== undefined
  ) {
    return
  }
  throw new Error(
    `Tool "${definition.name}" declares destructiveHint but is missing policy.destructive`
  )
}

function assertDestructivePolicyRequiresWrite(definition: {
  name: string
  policy?: ToolPolicy
}): void {
  if (
    definition.policy?.destructive === undefined ||
    definition.policy.effects === 'write'
  ) {
    return
  }
  throw new Error(
    `Tool "${definition.name}" destructive policy requires write effects`
  )
}

function assertDestructivePolicyDeclaresHint(definition: {
  name: string
  annotations?: ToolAnnotations
  policy?: ToolPolicy
}): void {
  if (
    definition.policy?.destructive === undefined ||
    definition.annotations?.destructiveHint === true
  ) {
    return
  }
  throw new Error(
    `Tool "${definition.name}" destructive policy requires destructiveHint: true`
  )
}

function validateOutputPolicy(definition: {
  name: string
  policy?: ToolPolicy
}): void {
  const output = definition.policy?.output
  if (
    output?.defaultPageSize === undefined ||
    output.maxPageSize === undefined ||
    output.defaultPageSize <= output.maxPageSize
  ) {
    return
  }
  throw new Error(
    `Tool "${definition.name}" output.defaultPageSize must not exceed output.maxPageSize`
  )
}

function validateOutboundHttpPolicy(definition: {
  name: string
  outputSchema?: Schema
  policy?: ToolPolicy
}): void {
  if (
    definition.policy?.outboundHttp === undefined ||
    definition.outputSchema !== undefined
  ) {
    return
  }
  throw new Error(
    `Tool "${definition.name}" outboundHttp policy requires outputSchema`
  )
}

function validateNumericToolPolicy(definition: {
  name: string
  policy?: ToolPolicy
}): void {
  validatePositiveInteger(
    definition.name,
    'policy.timeoutMs',
    definition.policy?.timeoutMs
  )
  validatePositiveInteger(
    definition.name,
    'policy.concurrency',
    definition.policy?.concurrency
  )
  validatePositiveInteger(
    definition.name,
    'policy.rateLimit.windowMs',
    definition.policy?.rateLimit?.windowMs
  )
  validatePositiveInteger(
    definition.name,
    'policy.rateLimit.maxCalls',
    definition.policy?.rateLimit?.maxCalls
  )
}

function validateAllowHosts(
  toolName: string,
  fieldName: string,
  allowHosts: readonly string[] | undefined
): void {
  if (allowHosts === undefined) return
  if (allowHosts.length === 0) {
    throw new Error(`Tool "${toolName}" ${fieldName} must not be empty`)
  }
}

function validatePositiveInteger(
  toolName: string,
  fieldName: string,
  value: number | undefined
): void {
  if (value === undefined) return
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `Tool "${toolName}" ${fieldName} must be a positive integer`
    )
  }
}
