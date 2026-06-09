import type {
  AgentPreset,
  GeneratorOptions,
  JsonObject,
  JsonValue,
  PackageManager,
  TransportPreset
} from './cli-contracts.js'

export function renderTemplateFile(
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

export function renderPackageJson(
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

export function renderJavaScriptTooling(path: string, content: string): string {
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

export function renderMain(transport: TransportPreset): string {
  if (transport === 'http') {
    return "throw new Error(\n  'HTTP transport is not implemented in this template yet. Use --transport stdio until the HTTP runtime milestone lands.'\n)\n"
  }
  if (transport === 'both') {
    return "import { startStdio } from './server/transports/stdio.js'\n\nconst transport = process.env['MCP_TRANSPORT'] ?? 'stdio'\nif (transport !== 'stdio') {\n  throw new Error('Only stdio transport is currently runnable in this template.')\n}\n\nawait startStdio()\n"
  }
  return "import { startStdio } from './server/transports/stdio.js'\n\nawait startStdio()\n"
}

export function capabilityContent(
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

export function ciWorkflowContent(packageManager: PackageManager): string {
  const run =
    packageManager === 'pnpm'
      ? 'corepack pnpm install --frozen-lockfile && corepack pnpm run quality:full'
      : 'npm install && npm run quality:full'
  return `name: CI\n\non:\n  pull_request:\n  push:\n    branches: [main]\n\njobs:\n  quality:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v5\n      - uses: actions/setup-node@v6\n        with:\n          node-version: 22\n      - run: corepack enable\n      - run: ${run}\n`
}

export function agentFiles(
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

function asJsonObject(value: JsonValue | undefined): JsonObject {
  return isJsonObject(value) ? value : {}
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
