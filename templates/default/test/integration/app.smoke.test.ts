import { describe, expect, it } from 'vitest'

import { app } from '../../src/app.js'

describe('application entrypoint', () => {
  it('composes an MCP application', () => {
    expect(app.connected).toBe(false)
    expect(app.sdk).toBeDefined()
  })
})
