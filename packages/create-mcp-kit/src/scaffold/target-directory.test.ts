import { beforeEach, describe, expect, it, vi } from 'vitest'

const { lstatMock, readdirMock, statMock } = vi.hoisted(() => ({
  lstatMock: vi.fn(),
  readdirMock: vi.fn(),
  statMock: vi.fn()
}))

vi.mock('node:fs/promises', () => ({
  lstat: lstatMock,
  readdir: readdirMock,
  stat: statMock
}))

import {
  assertEmptyOrMissing,
  assertTargetWithinRoot
} from './target-directory.js'

beforeEach(() => {
  lstatMock.mockReset()
  readdirMock.mockReset()
  statMock.mockReset()
})

describe('target directory guards', () => {
  it('accepts the workspace root itself as an in-bounds target', async () => {
    await expect(
      assertTargetWithinRoot('/repo', '/repo')
    ).resolves.toBeUndefined()
  })

  it('rethrows unexpected lstat failures while checking root traversal', async () => {
    lstatMock.mockRejectedValueOnce(new Error('permission denied'))

    await expect(
      assertTargetWithinRoot('/repo', '/repo/project')
    ).rejects.toThrow('permission denied')
  })

  it('treats missing targets as empty directories', async () => {
    const missing = new Error('missing')
    Object.assign(missing, { code: 'ENOENT' })
    statMock.mockRejectedValueOnce(missing)

    await expect(
      assertEmptyOrMissing('/repo/new-project')
    ).resolves.toBeUndefined()
  })
})
