import { lstat, readdir, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

export async function assertTargetWithinRoot(
  root: string,
  target: string
): Promise<void> {
  const normalizedRoot = resolve(root)
  const normalizedTarget = resolve(target)
  const relativeTarget = relative(normalizedRoot, normalizedTarget)

  if (relativeTarget === '') return
  if (isOutsideRoot(relativeTarget)) {
    throw new Error(`Target must stay within the working directory: ${target}`)
  }

  let current = normalizedRoot
  for (const segment of relativeTarget.split(sep)) {
    current = resolve(current, segment)
    if (!(await pathExists(current))) return
    await assertNotSymlink(current)
  }
}

function isOutsideRoot(relativeTarget: string): boolean {
  return relativeTarget === '..' || relativeTarget.startsWith(`..${sep}`)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

async function assertNotSymlink(path: string): Promise<void> {
  const entry = await lstat(path)
  if (entry.isSymbolicLink()) {
    throw new Error(`Target must not traverse symbolic links: ${path}`)
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
