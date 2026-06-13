export type AuthorizationConsent = {
  subject: string
  clientId: string
  scopes: readonly string[]
  grantedAt?: number
  expiresAt?: number
}

export type AuthorizationStepUp = {
  scopes: readonly string[]
  authorizationUrl?: string
}

export type AuthorizationDetails = {
  availableScopes?: readonly string[]
  consent?: AuthorizationConsent
  stepUp?: AuthorizationStepUp
}

export type AuthContext = {
  subject?: string
  scopes: readonly string[]
  tenantId?: string
  source: 'anonymous' | 'local' | 'oauth'
  clientId?: string
  expiresAt?: number
  resource?: URL
  token?: string
  authorization?: AuthorizationDetails
  extra?: Record<string, unknown>
}
