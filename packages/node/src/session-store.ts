import type { ManagedSession, SessionStore } from './http-contracts.js'
import { defineStoreAdapterMetadata } from './store-adapter-metadata.js'

export function createInMemorySessionStore(): SessionStore {
  const sessions = new Map<string, ManagedSession>()

  return defineStoreAdapterMetadata(
    {
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
    },
    {
      adapter: 'InMemorySessionStore',
      support: 'development-and-test'
    }
  )
}
