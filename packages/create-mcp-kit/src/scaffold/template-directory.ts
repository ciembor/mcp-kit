import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export function resolveDefaultTemplateCandidates(
  moduleUrl: string
): readonly string[] {
  return [
    fileURLToPath(new URL('../template', moduleUrl)),
    fileURLToPath(new URL('../../../../templates/default', moduleUrl))
  ]
}

export async function findTemplateDirectory(
  candidates: readonly string[]
): Promise<string> {
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isDirectory()) return candidate
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        continue
      }
      throw error
    }
  }
  throw new Error('Bundled project template was not found')
}
