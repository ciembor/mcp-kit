import type {
  ClientCapabilities,
  ElicitRequestFormParams,
  ElicitRequestURLParams
} from '@modelcontextprotocol/sdk/types.js'

import { McpKitError } from '../definitions.js'

export function elicitationSupport(capabilities: ClientCapabilities): {
  supportsElicitation: boolean
  supportsFormElicitation: boolean
  supportsUrlElicitation: boolean
} {
  const elicitation = capabilities.elicitation
  if (elicitation === undefined) {
    return {
      supportsElicitation: false,
      supportsFormElicitation: false,
      supportsUrlElicitation: false
    }
  }

  const supportsUrlElicitation = elicitation.url !== undefined
  const supportsFormElicitation =
    elicitation.form !== undefined || supportsUrlElicitation === false

  return {
    supportsElicitation: true,
    supportsFormElicitation,
    supportsUrlElicitation
  }
}

export function assertElicitationSupport(
  params: ElicitRequestFormParams | ElicitRequestURLParams,
  supportsElicitation: boolean,
  supportsFormElicitation: boolean,
  supportsUrlElicitation: boolean
): void {
  assertCapabilitySupported(
    supportsElicitation,
    'Client does not support elicitation/create',
    'Client does not support elicitation requests.'
  )
  const mode = params.mode ?? 'form'
  assertCapabilitySupported(
    mode !== 'form' || supportsFormElicitation,
    'Client does not support form elicitation requests',
    'Client does not support form elicitation requests.'
  )
  assertCapabilitySupported(
    mode !== 'url' || supportsUrlElicitation,
    'Client does not support URL elicitation requests',
    'Client does not support URL elicitation requests.'
  )
  if (mode === 'form' && 'requestedSchema' in params) {
    assertNoSensitiveFormFields(params)
  }
}

export function unsupportedCapability(
  message: string,
  safeMessage: string
): McpKitError {
  return new McpKitError({
    code: 'UNSUPPORTED_CAPABILITY',
    message,
    safeMessage
  })
}

function assertNoSensitiveFormFields(params: ElicitRequestFormParams): void {
  const properties = params.requestedSchema.properties
  for (const [name, field] of Object.entries(properties)) {
    if (!isSensitiveFormField(name, field)) continue
    throw new McpKitError({
      code: 'UNSAFE_ELICITATION',
      message: `Form elicitation must not request sensitive field "${name}"`,
      safeMessage:
        'Form elicitation must not request secrets. Use URL elicitation or another secure flow.'
    })
  }
}

function isSensitiveFormField(name: string, field: unknown): boolean {
  const parts = [name]
  if (isObject(field)) {
    const title = field.title
    const description = field.description
    if (typeof title === 'string') parts.push(title)
    if (typeof description === 'string') parts.push(description)
  }

  return parts.some((part) =>
    sensitiveTokenPattern.test(normalizeSensitiveText(part))
  )
}

function assertCapabilitySupported(
  supported: boolean,
  message: string,
  safeMessage: string
): void {
  if (supported) return
  throw unsupportedCapability(message, safeMessage)
}

function isObject(value: unknown): value is {
  title?: unknown
  description?: unknown
} {
  return typeof value === 'object' && value !== null
}

function normalizeSensitiveText(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, ' ').toLowerCase()
}

const sensitiveTokenPattern =
  /\b(pass(word|phrase)?|secret|token|api key|apikey|access key|private key|credential|auth(?:entication)? code)\b/
