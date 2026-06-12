import { lstat, readdir, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

export async function assertTargetWithinRoot(
  root: string,
  target: string
): Promise<void> {
  const normalizedRoot = resolve(root)
  const normalizedTarget = resolve(target)
  const relativeTarget = relative(normalizedRoot, normalizedTarget)

  if (
    relativeTarget === '..' ||
    relativeTarget.startsWith(`..${sep}`) ||
    relativeTarget === ''
  ) {
    if (relativeTarget === '') return
    throw new Error(`Target must stay within the working directory: ${target}`)
  }

  let current = normalizedRoot
  for (const segment of relativeTarget.split(sep)) {
    current = resolve(current, segment)
    try {
      const entry = await lstat(current)
      if (entry.isSymbolicLink()) {
        throw new Error(`Target must not traverse symbolic links: ${current}`)
      }
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return
      }
      throw error
    }
  }
}

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
