import type { AuthContext } from '@mcp-kit/core'
import type { EventStore } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

export type StreamableHttpEventStore = EventStore

export type ManagedSession = {
  readonly id: string
  readonly auth: AuthContext | undefined
  handleRequest(
    request: Request,
    parsedBody?: unknown,
    auth?: AuthContext
  ): Promise<Response>
  close(): Promise<void>
}

export type InProcessSessionStore = {
  get(sessionId: string): Promise<ManagedSession | undefined>
  set(sessionId: string, session: ManagedSession): Promise<void>
  delete(sessionId: string): Promise<void>
  list(): Promise<readonly ManagedSession[]>
}

export type SessionStore = InProcessSessionStore
