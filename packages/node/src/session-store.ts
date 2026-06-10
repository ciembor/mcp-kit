import type { ManagedSession, SessionStore } from './http-contracts.js'

export function createInMemorySessionStore(): SessionStore {
  const sessions = new Map<string, ManagedSession>()

  return {
    get(sessionId) {
      return Promise.resolve(sessions.get(sessionId))
    },
    set(sessionId, session) {
      sessions.set(sessionId, session)
      return Promise.resolve()
    },
    delete(sessionId) {
      sessions.delete(sessionId)
      return Promise.resolve()
    },
    list() {
      return Promise.resolve([...sessions.values()])
    }
  }
}
