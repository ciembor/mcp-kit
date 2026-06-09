import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getBoolean, getEnum, getString, parseArgs } from './cli-args.js'
import { runQuality, type QualityMode } from './quality.js'
import { CliError } from './cli-error.js'
import {
  exitCodes,
  packageInfo,
  type AgentPreset,
  type CapabilityInput,
  type CapabilityRegistrationInput,
  type CliIo,
  type CliResult,
  type DoctorDiagnostic,
  type FileOperation,
  type FilePlan,
  type GeneratorOptions,
  type JsonObject,
  type JsonValue,
  type PackageManager,
  type ParsedArgs,
  type ProjectContext,
  type ProjectLanguage,
  type TransportPreset
} from './cli-contracts.js'

export {
  analyzeProject,
  type ProjectAnalysis,
  type ProjectDiagnostic
} from './project-analysis.js'
export {
  defineQualityConfig,
  loadQualityConfig,
  resolveQualityConfig,
  runQuality,
  type CoverageExclusion,
  type CoverageThresholds,
  type QualityConfig,
  type QualityExecutor,
  type QualityMode,
  type QualityPreset,
  type QualityReport,
  type QualityStepResult,
  type ResolvedQualityConfig
} from './quality.js'
export {
  exitCodes,
  packageInfo,
  type AgentPreset,
  type CliIo,
  type CliResult,
  type DoctorDiagnostic,
  type ExitCode,
  type FileOperation,
  type FileOperationKind,
  type FilePlan,
  type JsonObject,
  type JsonValue,
  type PackageManager,
  type ProjectLanguage,
  type TransportPreset
} from './cli-contracts.js'

export async function runCli(
  args: readonly string[] = process.argv.slice(2),
  io: CliIo = {}
): Promise<number> {
  const stdout = io.stdout ?? process.stdout
  const stderr = io.stderr ?? process.stderr
  const cwd = io.cwd ?? process.cwd()
  const parsed = parseArgs(args)
  const json = getBoolean(parsed, 'json')

  try {
    const result = await dispatch(parsed, cwd)
    writeResult(result, { json, stdout, stderr })
    return result.exitCode ?? exitCodes.ok
  } catch (error) {
    const cliError =
      error instanceof CliError
        ? error
        : new CliError(errorMessage(error), exitCodes.internal)

    if (json) {
      stdout.write(
        `${JSON.stringify({
          ok: false,
          error: {
            message: cliError.message,
            exitCode: cliError.exitCode
          }
        })}\n`
      )
    } else {
      stderr.write(`mcp-kit: ${cliError.message}\n`)
    }
    return cliError.exitCode
  }
}

async function dispatch(parsed: ParsedArgs, cwd: string): Promise<CliResult> {
  switch (parsed.command) {
    case 'new':
      return createNewProject(parsed, cwd)
    case 'init':
      return initProject(parsed, cwd)
    case 'add':
      return addCapability(parsed, cwd)
    case 'doctor':
      return doctorProject(parsed, cwd)
    case 'quality':
      return qualityProject(parsed, cwd)
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      return { command: 'help' }
    default:
      throw new CliError(
        `Unknown command "${parsed.command}". Expected new, init, add, doctor or quality.`,
        exitCodes.usage
      )
  }
}

async function qualityProject(
  parsed: ParsedArgs,
  cwd: string
): Promise<CliResult> {
  const fast = getBoolean(parsed, 'fast')
  const full = getBoolean(parsed, 'full')
  if (fast === full) {
    throw new CliError('Usage: mcp-kit quality --fast|--full', exitCodes.usage)
  }
  const mode: QualityMode = fast ? 'fast' : 'full'
  const root = await detectProjectRoot(cwd, false)
  const controller = new AbortController()
  const interrupt = () => controller.abort()
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  try {
    const quality = await runQuality({
      root,
      mode,
      fix: getBoolean(parsed, 'fix'),
      signal: controller.signal,
      ...(getString(parsed, 'since') === undefined
        ? {}
        : { since: getString(parsed, 'since')! })
    })
    return {
      command: 'quality',
      root,
      quality,
      exitCode:
        quality.status === 'passed' ? exitCodes.ok : exitCodes.validation
    }
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
  }
}

async function createNewProject(
  parsed: ParsedArgs,
  cwd: string
): Promise<CliResult> {
  const name = parsed.positionals[0]
  if (name === undefined || name.trim() === '') {
    throw new CliError('Usage: mcp-kit new <name>', exitCodes.usage)
  }

  const transport = getEnum(parsed, 'transport', ['stdio', 'http', 'both'])
  const quality = getEnum(parsed, 'quality', ['off', 'standard', 'strict'])
  const language = getEnum(parsed, 'language', ['typescript', 'javascript'])
  const packageManager = getEnum(parsed, 'package-manager', [
    'pnpm',
    'npm',
    'yarn',
    'bun'
  ])
  const agent = getEnum(parsed, 'agent', [
    'none',
    'generic',
    'claude',
    'cursor',
    'codex'
  ])
  const options = {
    transport: transport ?? 'stdio',
    quality: quality ?? 'standard',
    language: language ?? 'typescript',
    packageManager: packageManager ?? detectPackageManager(cwd),
    git: !getBoolean(parsed, 'no-git'),
    hooks: !getBoolean(parsed, 'no-hooks'),
    ci: !getBoolean(parsed, 'no-ci'),
    install: !getBoolean(parsed, 'no-install'),
    agent: agent ?? 'none',
    force: getBoolean(parsed, 'force'),
    dryRun: getBoolean(parsed, 'dry-run')
  } satisfies GeneratorOptions

  const root = resolve(cwd, name)
  await assertSafeNewTarget(root, options.force)
  const plan = await planGeneratedProject(root, basename(root), options)

  if (!options.dryRun) {
    await applyPlan(plan, { allowOverwrite: options.force })
  }

  return { command: 'new', root, plan }
}

async function initProject(
  parsed: ParsedArgs,
  cwd: string
): Promise<CliResult> {
  const explicitRoot = getString(parsed, 'root')
  const root = explicitRoot
    ? resolve(cwd, explicitRoot)
    : await detectProjectRoot(cwd, getBoolean(parsed, 'here'))
  const entries = await safeReaddir(root)
  const hasPackageJson = await exists(resolve(root, 'package.json'))
  if (!hasPackageJson && entries.length > 0 && !getBoolean(parsed, 'force')) {
    throw new CliError(
      'Current directory is not empty and has no package.json. Use --force to initialize here.',
      exitCodes.conflict
    )
  }

  const context = await detectProjectContext(root)
  const quality = getEnum(parsed, 'quality', ['off', 'standard', 'strict'])
  const agent = getEnum(parsed, 'agent', [
    'none',
    'generic',
    'claude',
    'cursor',
    'codex'
  ])
  const options = {
    transport: 'stdio',
    quality: quality ?? 'standard',
    language: context.language,
    packageManager: context.packageManager,
    git: false,
    hooks: !getBoolean(parsed, 'no-hooks'),
    ci: !getBoolean(parsed, 'no-ci'),
    install: !getBoolean(parsed, 'no-install'),
    agent: agent ?? 'none',
    force: getBoolean(parsed, 'force'),
    dryRun: getBoolean(parsed, 'dry-run')
  } satisfies GeneratorOptions
  const plan = await planGeneratedProject(root, basename(root), options)

  if (!options.dryRun) {
    await applyPlan(plan, { allowOverwrite: false })
  }

  return { command: 'init', root, plan }
}

async function addCapability(
  parsed: ParsedArgs,
  cwd: string
): Promise<CliResult> {
  const kind = parsed.positionals[0]
  const rawName = parsed.positionals[1]
  if (
    kind !== 'tool' &&
    kind !== 'resource' &&
    kind !== 'prompt' &&
    kind !== undefined
  ) {
    throw new CliError(
      'Usage: mcp-kit add tool|resource|prompt <name>',
      exitCodes.usage
    )
  }
  if (kind === undefined || rawName === undefined || rawName.trim() === '') {
    throw new CliError(
      'Usage: mcp-kit add tool|resource|prompt <name>',
      exitCodes.usage
    )
  }

  const root = await detectProjectRoot(cwd, false)
  const context = await detectProjectContext(root)
  const feature = toKebabName(rawName)
  const symbol = toCamelName(rawName)
  const ext = context.language === 'typescript' ? 'ts' : 'js'
  const plan = await planAddCapability(root, {
    kind,
    feature,
    symbol,
    ext
  })

  if (!getBoolean(parsed, 'dry-run')) {
    await applyPlan(plan, { allowOverwrite: false })
  }

  return { command: 'add', root, plan }
}

async function doctorProject(
  parsed: ParsedArgs,
  cwd: string
): Promise<CliResult> {
  const root = await detectProjectRoot(cwd, getBoolean(parsed, 'here'))
  const context = await detectProjectContext(root)
  const diagnostics: DoctorDiagnostic[] = []

  diagnostics.push(nodeVersionDiagnostic(process.versions.node))
  diagnostics.push({
    level: 'ok',
    code: 'package-manager',
    message: `Detected ${context.packageManager}`
  })
  diagnostics.push(
    await fileDiagnostic(root, 'package.json', 'package-json', 'package.json')
  )
  diagnostics.push(
    await fileDiagnostic(root, 'tsconfig.json', 'tsconfig', 'tsconfig.json')
  )
  diagnostics.push(
    await fileDiagnostic(
      root,
      '.mcp-kit/manifest.json',
      'manifest',
      'mcp-kit manifest'
    )
  )
  diagnostics.push(await scriptsDiagnostic(root))
  diagnostics.push(await registryDiagnostic(root))
  diagnostics.push(await manifestDiagnostic(root))
  diagnostics.push(await stdoutDiagnostic(root))
  diagnostics.push(await httpDiagnostic(root))
  diagnostics.push(await boundedContextDiagnostic(root))

  return { command: 'doctor', root, diagnostics }
}

async function planGeneratedProject(
  root: string,
  rawName: string,
  options: GeneratorOptions
): Promise<FilePlan> {
  const template = await findTemplateDirectory()
  const files = await readTemplateFiles(template)
  const projectName = toPackageName(rawName)
  const operations: FileOperation[] = []

  for (const file of files) {
    const rendered = renderTemplateFile(file, {
      projectName,
      options
    })
    if (rendered === undefined) continue
    operations.push(
      await createOrMergeOperation(root, rendered.path, rendered.content)
    )
  }

  operations.push(
    await createOrMergeOperation(root, 'docs/tools.md', '# Tools\n\n- health\n')
  )

  if (options.ci) {
    operations.push(
      await createOrMergeOperation(
        root,
        '.github/workflows/ci.yml',
        ciWorkflowContent(options.packageManager)
      )
    )
  }
  if (options.hooks) {
    operations.push(
      await createOrMergeOperation(
        root,
        '.githooks/pre-commit',
        '#!/usr/bin/env sh\nset -eu\nnpm run quality:fast\n'
      )
    )
    if (options.quality === 'strict') {
      operations.push(
        await createOrMergeOperation(
          root,
          '.githooks/pre-push',
          '#!/usr/bin/env sh\nset -eu\nnpm run quality:full\n'
        )
      )
    }
  }
  for (const agentFile of agentFiles(options.agent)) {
    operations.push(
      await createOrMergeOperation(root, agentFile.path, agentFile.content)
    )
  }

  const manifest = buildManifest(operations, options)
  operations.push({
    kind: (await exists(resolve(root, '.mcp-kit/manifest.json')))
      ? 'overwrite'
      : 'create',
    path: '.mcp-kit/manifest.json',
    content: `${JSON.stringify(manifest, null, 2)}\n`
  })

  return { root, operations }
}

async function planAddCapability(
  root: string,
  input: CapabilityInput
): Promise<FilePlan> {
  const suffix = input.kind
  const exported = `${input.symbol}${capitalize(input.kind)}`
  const operations: FileOperation[] = []
  const path = `src/features/${input.feature}/mcp/${input.feature}.${suffix}.${input.ext}`
  operations.push(
    await createOrMergeOperation(
      root,
      path,
      capabilityContent(input.kind, exported)
    )
  )
  operations.push(await featureIndexUpdateOperation(root, input, exported))
  operations.push(
    await createOrMergeOperation(
      root,
      `test/contracts/${input.feature}.${input.kind}.contract.test.ts`,
      `import { describe, expect, it } from 'vitest'\n\nimport { ${exported} } from '../../src/features/${input.feature}/mcp/${input.feature}.${suffix}.js'\n\ndescribe('${input.feature} ${input.kind}', () => {\n  it('has a stable name', () => {\n    expect(${exported}.name).toBe('${input.feature}')\n  })\n})\n`
    )
  )
  operations.push(await registryUpdateOperation(root, input, exported))
  operations.push(await docsUpdateOperation(root, input))
  operations.push(await manifestUpdateOperation(root, operations))
  return { root, operations }
}

async function registryUpdateOperation(
  root: string,
  input: CapabilityRegistrationInput,
  exported: string
): Promise<FileOperation> {
  const path = 'src/mcp/registry.ts'
  const absolute = resolve(root, path)
  const importPath = `../features/${input.feature}/mcp/${input.feature}.${input.kind}.js`
  const registryNames = {
    tool: 'tools',
    resource: 'resources',
    prompt: 'prompts'
  } as const
  const registryName = registryNames[input.kind]
  const current = (await exists(absolute))
    ? await readFile(absolute, 'utf8')
    : "import { defineRegistry } from '@mcp-kit/core'\n\nexport const tools = defineRegistry([])\nexport const resources = defineRegistry([])\nexport const prompts = defineRegistry([])\n"

  if (current.includes(importPath) || current.includes(exported)) {
    return { kind: 'merge-package', path, content: current }
  }

  const lines = current.split('\n')
  const importLine = `import { ${exported} } from '${importPath}'`
  const lastImportIndex = lines.reduce(
    (last, line, index) => (line.startsWith('import ') ? index : last),
    -1
  )
  lines.splice(lastImportIndex + 1, 0, importLine)
  let updated = lines.join('\n')
  const registryPattern = new RegExp(
    `export const ${registryName} = defineRegistry\\(\\[([^\\]]*)\\]\\)`
  )
  updated = updated.replace(registryPattern, (_match, items: string) => {
    const existing = items
      .split(',')
      .map((item: string) => item.trim())
      .filter(Boolean)
    return `export const ${registryName} = defineRegistry([${[
      ...existing,
      exported
    ].join(', ')}])`
  })
  return { kind: 'overwrite', path, content: updated }
}

async function featureIndexUpdateOperation(
  root: string,
  input: CapabilityRegistrationInput,
  exported: string
): Promise<FileOperation> {
  const path = `src/features/${input.feature}/index.${input.ext}`
  const absolute = resolve(root, path)
  const exportLine = `export { ${exported} } from './mcp/${input.feature}.${input.kind}.js'`
  const current = (await exists(absolute))
    ? await readFile(absolute, 'utf8')
    : ''
  const separator = current.trim() === '' ? '' : '\n'
  const content = current.includes(exportLine)
    ? current
    : `${current.trimEnd()}${separator}${exportLine}\n`
  return {
    kind: (await exists(absolute)) ? 'overwrite' : 'create',
    path,
    content
  }
}

async function docsUpdateOperation(
  root: string,
  input: { kind: 'tool' | 'resource' | 'prompt'; feature: string }
): Promise<FileOperation> {
  const path = `docs/${input.kind}s.md`
  const absolute = resolve(root, path)
  const entry = `- ${input.feature}`
  const current = (await exists(absolute))
    ? await readFile(absolute, 'utf8')
    : `# ${capitalize(input.kind)}s\n\n`
  const content = current.includes(entry)
    ? current
    : `${current.trimEnd()}\n${entry}\n`
  return {
    kind: (await exists(absolute)) ? 'overwrite' : 'create',
    path,
    content
  }
}

async function manifestUpdateOperation(
  root: string,
  operations: readonly FileOperation[]
): Promise<FileOperation> {
  const existingManifest = await readJsonFile(
    resolve(root, '.mcp-kit/manifest.json')
  )
  const files =
    isJsonObject(existingManifest) && Array.isArray(existingManifest['files'])
      ? existingManifest['files'].filter(isJsonObject)
      : []
  const additions = operations
    .filter((operation) => operation.content !== undefined)
    .map((operation) => ({
      path: operation.path,
      checksum: sha256(operation.content!)
    }))
  return {
    kind: (await exists(resolve(root, '.mcp-kit/manifest.json')))
      ? 'overwrite'
      : 'create',
    path: '.mcp-kit/manifest.json',
    content: `${JSON.stringify(
      {
        generator: packageInfo.version,
        updatedAt: new Date(0).toISOString(),
        files: mergeManifestFiles([...files, ...additions])
      },
      null,
      2
    )}\n`
  }
}

function renderTemplateFile(
  file: { path: string; content: string },
  input: { projectName: string; options: GeneratorOptions }
): { path: string; content: string } | undefined {
  let path = file.path
  let content = file.content
    .replaceAll('{{PROJECT_NAME}}', input.projectName)
    .replaceAll('{{MCP_KIT_CORE}}', '^0.0.0')
    .replaceAll('{{MCP_KIT_NODE}}', '^0.0.0')
    .replaceAll('{{MCP_KIT_CLI}}', '^0.0.0')
    .replaceAll('{{MCP_KIT_TESTING}}', '^0.0.0')
    .replaceAll(' /* {{STRICT_DEPENDENCY_RULES}} */', () =>
      input.options.quality === 'strict'
        ? ",\n    {\n      name: 'no-orphan-modules',\n      severity: 'error',\n      from: {\n        orphan: true,\n        pathNot: '(^|/)(main|index|.*\\\\.test)\\\\.[cm]?[jt]s$'\n      },\n      to: {}\n    }"
        : ''
    )

  if (path === 'package.json') {
    content = renderPackageJson(content, input.options)
  }
  if (path === 'mcp-kit.config.ts') {
    content = mcpKitConfigContent(input.options)
  }
  if (path === 'quality.config.js') {
    content = qualityConfigContent(input.options)
  }
  if (path === 'src/main.ts') {
    content = renderMain(input.options.transport)
  }
  if (
    input.options.transport === 'http' &&
    (/\/stdio\.[cm]?[jt]s$/.test(path) ||
      /\/stdio\.test\.[cm]?[jt]s$/.test(path))
  ) {
    return undefined
  }
  if (input.options.language === 'javascript') {
    if (path === 'tsconfig.json') return undefined
    if (path === 'vitest.config.ts') {
      path = 'vitest.config.js'
    }
    if (path.endsWith('.ts')) {
      path = `${path.slice(0, -3)}.js`
      content = toJavaScript(content)
      if (content === '') return undefined
    }
    content = renderJavaScriptTooling(path, content)
  }
  return { path, content }
}

function renderPackageJson(
  template: string,
  options: GeneratorOptions
): string {
  const packageJson = JSON.parse(template) as JsonObject
  packageJson['packageManager'] = packageManagerSpec(options.packageManager)
  const scripts = asJsonObject(packageJson['scripts'])
  if (options.language === 'javascript') {
    scripts['start'] = 'node src/main.js'
    delete scripts['build']
    delete scripts['typecheck']
    const devDependencies = asJsonObject(packageJson['devDependencies'])
    delete devDependencies['@types/node']
    delete devDependencies['typescript']
    delete devDependencies['typescript-eslint']
    if (Object.keys(devDependencies).length === 0) {
      delete packageJson['devDependencies']
    } else {
      packageJson['devDependencies'] = devDependencies
    }
  }
  if (options.transport === 'http') {
    scripts['start'] = 'node src/main.js'
    const dependencies = asJsonObject(packageJson['dependencies'])
    delete dependencies['@mcp-kit/node']
    packageJson['dependencies'] = dependencies
  }
  packageJson['scripts'] = scripts
  return `${JSON.stringify(packageJson, null, 2)}\n`
}

function packageManagerSpec(packageManager: PackageManager): string {
  switch (packageManager) {
    case 'pnpm':
      return 'pnpm@11.5.2'
    case 'npm':
      return 'npm@11.4.2'
    case 'yarn':
      return 'yarn@1.22.22'
    case 'bun':
      return 'bun@1.2.15'
  }
}

function renderJavaScriptTooling(path: string, content: string): string {
  if (path === 'eslint.config.js') {
    return "import js from '@eslint/js'\nimport { defineConfig, globalIgnores } from 'eslint/config'\n\nexport default defineConfig(\n  globalIgnores(['dist/**', 'coverage/**', 'node_modules/**']),\n  js.configs.recommended,\n  {\n    languageOptions: {\n      globals: {\n        process: 'readonly'\n      }\n    }\n  }\n)\n"
  }
  if (path === 'dependency-cruiser.config.cjs') {
    return content.replace("    tsConfig: { fileName: 'tsconfig.json' },\n", '')
  }
  if (path === 'eslint.smells.config.js') {
    return content
      .replace("import tseslint from 'typescript-eslint'\n", '')
      .replace(
        ',\n    languageOptions: {\n      parser: tseslint.parser\n    }',
        ''
      )
  }
  if (path === 'knip.json') {
    const config = JSON.parse(content.replaceAll('.ts', '.js')) as JsonObject
    config['entry'] = Array.isArray(config['entry'])
      ? config['entry'].filter((entry) => entry !== 'src/main.js')
      : []
    return `${JSON.stringify(config, null, 2)}\n`
  }
  if (path === 'vitest.config.js') {
    return content.replaceAll('.ts', '.js')
  }
  return content
}

function renderMain(transport: TransportPreset): string {
  if (transport === 'http') {
    return "throw new Error(\n  'HTTP transport is not implemented in this template yet. Use --transport stdio until the HTTP runtime milestone lands.'\n)\n"
  }
  if (transport === 'both') {
    return "import { startStdio } from './server/transports/stdio.js'\n\nconst transport = process.env['MCP_TRANSPORT'] ?? 'stdio'\nif (transport !== 'stdio') {\n  throw new Error('Only stdio transport is currently runnable in this template.')\n}\n\nawait startStdio()\n"
  }
  return "import { startStdio } from './server/transports/stdio.js'\n\nawait startStdio()\n"
}

function toJavaScript(content: string): string {
  const converted = content
    .replace(/^import type .*$/gm, '')
    .replace(/^export type [\s\S]*?\n}\n/gm, '')
    .replace(/^export type .*$/gm, '')
    .replace(/: HealthStatus/g, '')
    .replace(/ satisfies [A-Za-z0-9_<>]+/g, '')
    .trim()
  return converted === '' ? '' : `${converted}\n`
}

function capabilityContent(
  kind: 'tool' | 'resource' | 'prompt',
  exported: string
): string {
  if (kind === 'resource') {
    return `import { defineResource } from '@mcp-kit/core'\n\nexport const ${exported} = defineResource({\n  name: '${exported.replace(/Resource$/, '')}',\n  uri: '${exported.replace(/Resource$/, '')}://value',\n  read: ({ uri }) => ({\n    contents: [{ uri: uri.toString(), text: 'TODO' }]\n  })\n})\n`
  }
  if (kind === 'prompt') {
    return `import { definePrompt } from '@mcp-kit/core'\nimport { z } from 'zod'\n\nexport const ${exported} = definePrompt({\n  name: '${exported.replace(/Prompt$/, '')}',\n  argsSchema: z.object({}),\n  render: () => ({\n    messages: [{ role: 'user', content: { type: 'text', text: 'TODO' } }]\n  })\n})\n`
  }
  return `import { defineTool } from '@mcp-kit/core'\nimport { z } from 'zod'\n\nexport const ${exported} = defineTool({\n  name: '${exported.replace(/Tool$/, '')}',\n  inputSchema: z.object({}),\n  outputSchema: z.object({ ok: z.boolean() }),\n  policy: { effects: 'read' },\n  handler: () => ({\n    structuredContent: { ok: true },\n    content: [{ type: 'text', text: 'ok' }]\n  })\n})\n`
}

async function createOrMergeOperation(
  root: string,
  path: string,
  content: string
): Promise<FileOperation> {
  const absolute = resolve(root, path)
  if (!(await exists(absolute))) {
    return { kind: 'create', path, content }
  }
  const existing = await readFile(absolute, 'utf8')
  if (existing === content) {
    return { kind: 'create', path, content }
  }
  if (path === 'package.json') {
    return {
      kind: 'merge-package',
      path,
      content: `${JSON.stringify(
        mergePackageJson(
          JSON.parse(existing) as JsonObject,
          JSON.parse(content) as JsonObject
        ),
        null,
        2
      )}\n`
    }
  }
  if (path.endsWith('.json')) {
    return {
      kind: 'merge-json',
      path,
      content: `${JSON.stringify(
        deepMerge(
          JSON.parse(existing) as JsonObject,
          JSON.parse(content) as JsonObject
        ),
        null,
        2
      )}\n`
    }
  }
  if (path.endsWith('.yml') || path.endsWith('.yaml')) {
    return {
      kind: 'merge-yaml',
      path,
      content: conflictContent(existing, content)
    }
  }
  return {
    kind: 'conflict',
    path: `${path}.mcp-kit.conflict`,
    content: conflictContent(existing, content)
  }
}

async function applyPlan(
  plan: FilePlan,
  options: { allowOverwrite: boolean }
): Promise<void> {
  const backups: { path: string; backupPath: string }[] = []
  const written: string[] = []

  try {
    await mkdir(plan.root, { recursive: true })
    for (const operation of plan.operations) {
      if (operation.content === undefined) continue
      const absolute = resolve(plan.root, operation.path)
      await mkdir(dirname(absolute), { recursive: true })

      if (await exists(absolute)) {
        if (
          operation.kind === 'create' ||
          (operation.kind === 'overwrite' &&
            !options.allowOverwrite &&
            operation.path.endsWith('.mcp-kit.conflict'))
        ) {
          const existing = await readFile(absolute, 'utf8')
          if (existing === operation.content) continue
          throw new CliError(
            `Refusing to overwrite unmanaged file: ${operation.path}`,
            exitCodes.conflict
          )
        }
        const backupPath = `${absolute}.mcp-kit-backup`
        await rm(backupPath, { force: true })
        await rename(absolute, backupPath)
        backups.push({ path: absolute, backupPath })
      }

      await writeFile(absolute, operation.content)
      written.push(absolute)
    }
  } catch (error) {
    await Promise.all(written.map((path) => rm(path, { force: true })))
    for (const backup of backups.reverse()) {
      /* v8 ignore next 2 -- best-effort cleanup when backup restore itself fails. */
      await rename(backup.backupPath, backup.path).catch(async () => {
        await rm(backup.backupPath, { force: true })
      })
    }
    throw error
  }

  await Promise.all(
    backups.map((backup) => rm(backup.backupPath, { force: true }))
  )
}

async function assertSafeNewTarget(
  root: string,
  force: boolean
): Promise<void> {
  try {
    const targetStat = await stat(root)
    if (!targetStat.isDirectory()) {
      throw new CliError(
        `Target exists and is not a directory: ${root}`,
        exitCodes.conflict
      )
    }
    if (!force && (await readdir(root)).length > 0) {
      throw new CliError(
        `Target directory is not empty: ${root}`,
        exitCodes.conflict
      )
    }
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return
    throw error
  }
}

async function detectProjectRoot(cwd: string, here: boolean): Promise<string> {
  if (here) return cwd
  const gitRoot = await findUp(cwd, '.git')
  if (gitRoot !== undefined) return gitRoot
  const packageRoot = await findUp(cwd, 'package.json')
  return packageRoot ?? cwd
}

async function detectProjectContext(root: string): Promise<ProjectContext> {
  const gitRoot = await findUp(root, '.git')
  const context: ProjectContext = {
    root,
    packageManager: detectPackageManager(root),
    language: await detectLanguage(root)
  }
  if (gitRoot !== undefined) context.gitRoot = gitRoot
  return context
}

function detectPackageManager(root: string): PackageManager {
  if (existsSync(resolve(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(resolve(root, 'package-lock.json'))) return 'npm'
  if (existsSync(resolve(root, 'yarn.lock'))) return 'yarn'
  if (existsSync(resolve(root, 'bun.lockb'))) return 'bun'
  return 'pnpm'
}

async function detectLanguage(root: string): Promise<ProjectLanguage> {
  if (await exists(resolve(root, 'tsconfig.json'))) return 'typescript'
  const packageJson = await readJsonFile(resolve(root, 'package.json'))
  if (
    isJsonObject(packageJson) &&
    isJsonObject(packageJson['devDependencies']) &&
    packageJson['devDependencies']['typescript'] !== undefined
  ) {
    return 'typescript'
  }
  return 'javascript'
}

async function findUp(
  start: string,
  marker: string
): Promise<string | undefined> {
  let current = resolve(start)
  while (true) {
    if (await exists(resolve(current, marker))) return current
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

async function findTemplateDirectory(
  candidates: readonly string[] = [
    fileURLToPath(new URL('./template', import.meta.url)),
    fileURLToPath(new URL('../../../templates/default', import.meta.url))
  ]
): Promise<string> {
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isDirectory()) return candidate
    } catch (error) {
      if (isNodeErrorCode(error, 'ENOENT')) continue
      throw error
    }
  }
  throw new CliError(
    'Bundled project template was not found',
    exitCodes.internal
  )
}

async function readTemplateFiles(
  directory: string,
  prefix = ''
): Promise<{ path: string; content: string }[]> {
  const files: { path: string; content: string }[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    const absolute = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await readTemplateFiles(absolute, path)))
    } else {
      files.push({ path, content: await readFile(absolute, 'utf8') })
    }
  }
  return files
}

function buildManifest(
  operations: readonly FileOperation[],
  options: GeneratorOptions
): JsonObject {
  return {
    generator: packageInfo.version,
    template: 'default',
    templateVersion: '0.0.0',
    options: {
      transport: options.transport,
      quality: options.quality,
      language: options.language,
      packageManager: options.packageManager,
      hooks: options.hooks,
      ci: options.ci,
      agent: options.agent
    },
    files: operations
      .filter((operation) => operation.content !== undefined)
      .map((operation) => ({
        path: operation.path,
        kind: operation.kind,
        checksum: sha256(operation.content!)
      }))
  }
}

function mergeManifestFiles(files: readonly JsonObject[]): JsonObject[] {
  const byPath = new Map<string, JsonObject>()
  for (const file of files) {
    const path = file['path']
    if (typeof path === 'string') byPath.set(path, file)
  }
  return [...byPath.values()].sort((left, right) => {
    const leftPath = left['path'] as string
    const rightPath = right['path'] as string
    if (leftPath < rightPath) return -1
    return 1
  })
}

function mcpKitConfigContent(options: GeneratorOptions): string {
  return `export default {\n  boundedContext: 'default',\n  transport: '${options.transport}',\n  quality: '${options.quality}'\n}\n`
}

function qualityConfigContent(options: GeneratorOptions): string {
  const quality = options.quality
  const extension = options.language === 'typescript' ? 'ts' : 'js'
  const strict =
    quality === 'strict'
      ? `,\n    strictInclude: [\n      'src/features/*/domain/**/*.${extension}',\n      'src/features/*/application/**/*.${extension}'\n    ]`
      : ''
  return `import { defineQualityConfig } from '@mcp-kit/cli'\n\nexport default defineQualityConfig({\n  preset: '${quality}',\n  project: {\n    root: '.',\n    source: ['src/**/*.${extension}'],\n    tests: ['test/**/*.test.${extension}']\n  },\n  formatting: {\n    command: 'prettier --check .',\n    fixCommand: 'prettier --write .'\n  },\n  lint: {\n    command: 'eslint .',\n    fixCommand: 'eslint . --fix',\n    typed: ${options.language === 'typescript'}\n  },\n  smells: {\n    command: 'eslint --config eslint.smells.config.js'\n  },\n  typecheck: {\n    enabled: ${quality !== 'off' && options.language === 'typescript'},\n    command: 'npm run typecheck --if-present'\n  },\n  deadCode: {\n    command: 'knip'\n  },\n  dependencyCruiser: {\n    command: 'dependency-cruiser src --config dependency-cruiser.config.cjs'\n  },\n  tests: {\n    unit: { command: 'vitest run' }\n  },\n  coverage: {\n    enabled: ${quality !== 'off'},\n    include: ['src/**/*.${extension}'],\n    exclude: [\n      {\n        pattern: 'src/**/index.${extension}',\n        reason:\n          'Public export-only boundaries are verified by architecture tests.'\n      },\n      {\n        pattern: 'src/main.${extension}',\n        reason:\n          'The process entrypoint is covered by the stdio integration smoke test.'\n      }\n    ]${strict}\n  },\n  build: {\n    command: 'npm run build --if-present'\n  }\n})\n`
}

function ciWorkflowContent(packageManager: PackageManager): string {
  const run =
    packageManager === 'pnpm'
      ? 'corepack pnpm install --frozen-lockfile && corepack pnpm run quality:full'
      : 'npm install && npm run quality:full'
  return `name: CI\n\non:\n  pull_request:\n  push:\n    branches: [main]\n\njobs:\n  quality:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v5\n      - uses: actions/setup-node@v6\n        with:\n          node-version: 22\n      - run: corepack enable\n      - run: ${run}\n`
}

function agentFiles(
  agent: AgentPreset
): readonly { path: string; content: string }[] {
  switch (agent) {
    case 'generic':
      return [
        {
          path: 'AGENTS.md',
          content: '# Agent Instructions\n\nUse mcp-kit conventions.\n'
        }
      ]
    case 'claude':
      return [
        { path: 'CLAUDE.md', content: '# Claude\n\nUse mcp-kit conventions.\n' }
      ]
    case 'cursor':
      return [
        {
          path: '.cursor/rules/mcp-kit.md',
          content: '# mcp-kit\n\nUse mcp-kit conventions.\n'
        }
      ]
    case 'codex':
      return [
        { path: 'AGENTS.md', content: '# Codex\n\nUse mcp-kit conventions.\n' }
      ]
    case 'none':
      return []
  }
}

function mergePackageJson(existing: JsonObject, next: JsonObject): JsonObject {
  return {
    ...existing,
    scripts: deepMerge(
      asJsonObject(existing['scripts']),
      asJsonObject(next['scripts'])
    ),
    dependencies: deepMerge(
      asJsonObject(existing['dependencies']),
      asJsonObject(next['dependencies'])
    ),
    devDependencies: deepMerge(
      asJsonObject(existing['devDependencies']),
      asJsonObject(next['devDependencies'])
    )
  }
}

function deepMerge(left: JsonObject, right: JsonObject): JsonObject {
  const merged: JsonObject = { ...left }
  for (const [key, value] of Object.entries(right)) {
    const current = merged[key]
    merged[key] =
      isJsonObject(current) && isJsonObject(value)
        ? deepMerge(current, value)
        : value
  }
  return merged
}

function conflictContent(existing: string, next: string): string {
  return `<<<<<<< existing\n${existing.trimEnd()}\n=======\n${next.trimEnd()}\n>>>>>>> mcp-kit\n`
}

async function fileDiagnostic(
  root: string,
  path: string,
  code: string,
  label: string
): Promise<DoctorDiagnostic> {
  return {
    level: (await exists(resolve(root, path))) ? 'ok' : 'error',
    code,
    message: `${label} ${(await exists(resolve(root, path))) ? 'exists' : 'is missing'}`
  }
}

async function scriptsDiagnostic(root: string): Promise<DoctorDiagnostic> {
  const packageJson = await readJsonFile(resolve(root, 'package.json'))
  if (!isJsonObject(packageJson)) {
    return {
      level: 'error',
      code: 'scripts',
      message: 'package.json is missing or invalid'
    }
  }
  const scripts = asJsonObject(packageJson['scripts'])
  return {
    level: scripts['start'] === undefined ? 'warning' : 'ok',
    code: 'scripts',
    message:
      scripts['start'] === undefined
        ? 'start script is missing'
        : 'start script exists'
  }
}

async function registryDiagnostic(root: string): Promise<DoctorDiagnostic> {
  const path = resolve(root, 'src/mcp/registry.ts')
  if (!(await exists(path))) {
    return {
      level: 'error',
      code: 'registry',
      message: 'src/mcp/registry.ts is missing'
    }
  }
  const content = await readFile(path, 'utf8')
  return {
    level: content.includes('defineRegistry') ? 'ok' : 'error',
    code: 'registry',
    message: content.includes('defineRegistry')
      ? 'registry uses defineRegistry'
      : 'registry does not use defineRegistry'
  }
}

async function manifestDiagnostic(root: string): Promise<DoctorDiagnostic> {
  const manifest = await readJsonFile(resolve(root, '.mcp-kit/manifest.json'))
  if (!isJsonObject(manifest) || !Array.isArray(manifest['files'])) {
    return {
      level: 'warning',
      code: 'manifest-integrity',
      message: 'manifest is missing or has no files list'
    }
  }
  const missing: string[] = []
  const modified: string[] = []
  for (const file of manifest['files']) {
    if (!isJsonObject(file) || typeof file['path'] !== 'string') continue
    const absolute = resolve(root, file['path'])
    if (!(await exists(absolute))) {
      missing.push(file['path'])
      continue
    }
    if (
      typeof file['checksum'] === 'string' &&
      sha256(await readFile(absolute, 'utf8')) !== file['checksum']
    ) {
      modified.push(file['path'])
    }
  }
  if (missing.length > 0 || modified.length > 0) {
    return {
      level: 'warning',
      code: 'manifest-integrity',
      message: `Manifest drift: ${missing.length} missing, ${modified.length} modified`
    }
  }
  return {
    level: 'ok',
    code: 'manifest-integrity',
    message: 'manifest entries are present and unchanged'
  }
}

async function stdoutDiagnostic(root: string): Promise<DoctorDiagnostic> {
  const stdioPath = resolve(root, 'src/server/transports/stdio.ts')
  if (!(await exists(stdioPath))) {
    return {
      level: 'warning',
      code: 'stdio-stdout',
      message: 'stdio transport file is missing'
    }
  }
  const content = await readFile(stdioPath, 'utf8')
  const unsafe = /console\.log|process\.stdout\.write/.test(content)
  return {
    level: unsafe ? 'error' : 'ok',
    code: 'stdio-stdout',
    message: unsafe
      ? 'stdio transport writes application output to stdout'
      : 'stdio transport does not write application output to stdout'
  }
}

async function httpDiagnostic(root: string): Promise<DoctorDiagnostic> {
  const configPath = resolve(root, 'mcp-kit.config.ts')
  const content = (await exists(configPath))
    ? await readFile(configPath, 'utf8')
    : ''
  const productionHttp =
    content.includes("transport: 'http'") &&
    content.includes('inMemory') &&
    process.env['NODE_ENV'] === 'production'
  return {
    level: productionHttp ? 'error' : 'ok',
    code: 'http-security',
    message: productionHttp
      ? 'production HTTP uses an in-memory store'
      : 'no unsafe production HTTP configuration detected'
  }
}

async function boundedContextDiagnostic(
  root: string
): Promise<DoctorDiagnostic> {
  const configPath = resolve(root, 'mcp-kit.config.ts')
  const content = (await exists(configPath))
    ? await readFile(configPath, 'utf8')
    : ''
  const broad =
    content.includes("boundedContext: '*'") ||
    content.includes("boundedContext: 'all'")
  return {
    level: broad ? 'warning' : 'ok',
    code: 'bounded-context',
    message: broad
      ? 'bounded context is broader than recommended'
      : 'bounded context configuration is present or not broad'
  }
}

function writeResult(
  result: CliResult,
  io: {
    json: boolean
    stdout: Pick<NodeJS.WriteStream, 'write'>
    stderr: Pick<NodeJS.WriteStream, 'write'>
  }
): void {
  if (io.json) {
    io.stdout.write(
      `${JSON.stringify({
        ok: result.quality?.status !== 'failed',
        ...result
      })}\n`
    )
    return
  }
  if (result.command === 'help') {
    io.stdout.write(helpText())
    return
  }
  if (result.command === 'doctor') {
    for (const diagnostic of result.diagnostics!) {
      io.stdout.write(
        `[${diagnostic.level}] ${diagnostic.code}: ${diagnostic.message}\n`
      )
    }
    return
  }
  if (result.command === 'quality') {
    for (const step of result.quality!.steps) {
      io.stdout.write(
        `[${step.status}] ${step.name} ${formatDuration(step.durationMs)}\n`
      )
      for (const diagnostic of step.diagnostics ?? []) {
        const location =
          diagnostic.line === undefined
            ? diagnostic.file
            : `${diagnostic.file}:${diagnostic.line}`
        io.stdout.write(
          `  ${location} ${diagnostic.rule}: ${diagnostic.message}\n`
        )
      }
    }
    for (const exclusion of result.quality!.coverage.exclusions) {
      io.stdout.write(
        `[coverage-exclusion] ${exclusion.pattern}: ${exclusion.reason}\n`
      )
    }
    io.stdout.write(
      `quality ${result.quality!.status} in ${formatDuration(result.quality!.durationMs)}\n`
    )
    return
  }
  const count = result.plan!.operations.length
  io.stderr.write(
    `${result.command}: planned ${count} file operations in ${result.root}\n`
  )
}

function helpText(): string {
  return `Usage: mcp-kit <command>\n\nCommands:\n  new <name>\n  init\n  add tool|resource|prompt <name>\n  doctor\n  quality --fast|--full [--fix] [--since <git-ref>] [--json]\n`
}

function formatDuration(durationMs: number): string {
  return durationMs < 1000
    ? `${durationMs}ms`
    : `${(durationMs / 1000).toFixed(1)}s`
}

async function safeReaddir(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return []
    throw error
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return false
    throw error
  }
}

async function readJsonFile(path: string): Promise<JsonValue | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as JsonValue
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return undefined
    return undefined
  }
}

function asJsonObject(value: JsonValue | undefined): JsonObject {
  return isJsonObject(value) ? value : {}
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isSupportedNodeVersion(version: string): boolean {
  const [majorRaw, minorRaw] = version.split('.')
  const major = Number(majorRaw)
  const minor = Number(minorRaw)
  return major === 24 || (major === 22 && minor >= 13)
}

function nodeVersionDiagnostic(version: string): DoctorDiagnostic {
  return {
    level: isSupportedNodeVersion(version) ? 'ok' : 'error',
    code: 'node-version',
    message: `Node.js ${version}`
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function toPackageName(value: string): string {
  const normalized = toKebabName(value)
  if (normalized === '') {
    throw new CliError(
      `Cannot derive a package name from "${value}"`,
      exitCodes.validation
    )
  }
  return normalized
}

function toKebabName(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
  return trimEdgeHyphens(normalized)
}

function trimEdgeHyphens(value: string): string {
  let start = 0
  let end = value.length
  while (value[start] === '-') start += 1
  while (value[end - 1] === '-') end -= 1
  return value.slice(start, end)
}

function toCamelName(value: string): string {
  const kebab = toKebabName(value)
  return kebab.replace(/-([a-z0-9])/g, (_match, letter: string) =>
    letter.toUpperCase()
  )
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}

export const internals = {
  parseArgs,
  planGeneratedProject,
  planAddCapability,
  applyPlan,
  detectProjectRoot,
  detectProjectContext,
  createOrMergeOperation,
  detectLanguage,
  detectPackageManager,
  safeReaddir,
  exists,
  readJsonFile,
  errorMessage,
  isSupportedNodeVersion,
  nodeVersionDiagnostic,
  buildManifest,
  mergeManifestFiles,
  agentFiles,
  findTemplateDirectory,
  renderMain,
  renderPackageJson,
  toPackageName
}
