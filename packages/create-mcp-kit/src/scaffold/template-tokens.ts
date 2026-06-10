import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { CreateMcpKitOptions } from './create-project.js'
import { packageInfo } from '../shared/package-info.js'

export function templateReplacements(
  projectName: string,
  options: CreateMcpKitOptions
): Readonly<Record<string, string>> {
  const fallback = `^${packageInfo.version}`
  return {
    '{{PROJECT_NAME}}': projectName,
    '{{MCP_KIT_CORE}}': packageSpec(
      options.corePackage,
      'MCP_KIT_CORE_SPEC',
      fallback
    ),
    '{{MCP_KIT_NODE}}': packageSpec(
      options.nodePackage,
      'MCP_KIT_NODE_SPEC',
      fallback
    ),
    '{{MCP_KIT_CLI}}': packageSpec(
      options.cliPackage,
      'MCP_KIT_CLI_SPEC',
      fallback
    ),
    '{{MCP_KIT_TESTING}}': packageSpec(
      options.testingPackage,
      'MCP_KIT_TESTING_SPEC',
      fallback
    ),
    ' /* {{STRICT_DEPENDENCY_RULES}} */': ''
  }
}

function packageSpec(
  explicit: string | undefined,
  environmentName: string,
  fallback: string
): string {
  return explicit ?? process.env[environmentName] ?? fallback
}

export async function replaceTemplateTokens(
  directory: string,
  replacements: Readonly<Record<string, string>>
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      await replaceTemplateTokens(path, replacements)
      continue
    }

    const original = await readFile(path, 'utf8')
    let updated = original
    for (const [token, value] of Object.entries(replacements)) {
      updated = updated.replaceAll(token, value)
    }
    if (updated !== original) {
      await writeFile(path, updated)
    }
  }
}
