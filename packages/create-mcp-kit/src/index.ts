import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const packageInfo = {
  name: 'create-mcp-kit',
  version: '0.0.0'
} as const

export type CreateMcpKitOptions = {
  cwd?: string
  corePackage?: string
  nodePackage?: string
  cliPackage?: string
  testingPackage?: string
  templateDirectory?: string
}

export async function createMcpKitProject(
  projectPath: string,
  options: CreateMcpKitOptions = {}
): Promise<string> {
  if (projectPath.trim() === '') {
    throw new Error('Project directory is required')
  }

  const target = resolve(options.cwd ?? process.cwd(), projectPath)
  await assertEmptyOrMissing(target)
  await mkdir(target, { recursive: true })

  const template =
    options.templateDirectory ??
    (await findTemplateDirectory([
      fileURLToPath(new URL('./template', import.meta.url)),
      fileURLToPath(new URL('../../../templates/default', import.meta.url))
    ]))
  await cp(template, target, { recursive: true })

  const projectName = toPackageName(basename(target))
  await replaceTemplateTokens(target, {
    '{{PROJECT_NAME}}': projectName,
    '{{MCP_KIT_CORE}}':
      options.corePackage ??
      process.env['MCP_KIT_CORE_SPEC'] ??
      `^${packageInfo.version}`,
    '{{MCP_KIT_NODE}}':
      options.nodePackage ??
      process.env['MCP_KIT_NODE_SPEC'] ??
      `^${packageInfo.version}`,
    '{{MCP_KIT_CLI}}':
      options.cliPackage ??
      process.env['MCP_KIT_CLI_SPEC'] ??
      `^${packageInfo.version}`,
    '{{MCP_KIT_TESTING}}':
      options.testingPackage ??
      process.env['MCP_KIT_TESTING_SPEC'] ??
      `^${packageInfo.version}`,
    ' /* {{STRICT_DEPENDENCY_RULES}} */': ''
  })

  return target
}

async function findTemplateDirectory(
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

export async function runCreateMcpKit(
  args: readonly string[] = process.argv.slice(2)
): Promise<number> {
  const projectPath = args.find((argument) => argument !== '--')
  if (projectPath === undefined) {
    process.stderr.write(
      'Usage: npm create mcp-kit@latest <project-directory>\n'
    )
    return 1
  }

  try {
    const target = await createMcpKitProject(projectPath)
    process.stderr.write(`Created MCP server in ${target}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`create-mcp-kit: ${errorMessage(error)}\n`)
    return 1
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function assertEmptyOrMissing(target: string): Promise<void> {
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

async function replaceTemplateTokens(
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

function toPackageName(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (normalized === '') {
    throw new Error(`Cannot derive a package name from "${value}"`)
  }
  return normalized
}

export const internals = {
  errorMessage,
  findTemplateDirectory
}
