import { readdir, stat } from 'node:fs/promises'

export async function assertEmptyOrMissing(target: string): Promise<void> {
  try {
    const targetStat = await stat(target)
    if (!targetStat.isDirectory()) {
      throw new Error(`Target exists and is not a directory: ${target}`)
    }
    if ((await readdir(target)).length > 0) {
      throw new Error(`Target directory is not empty: ${target}`)
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return
    }
    throw error
  }
}
