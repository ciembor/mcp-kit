import { describe, expect, it } from 'vitest'

import {
  agentFiles,
  ciWorkflowContent,
  renderJavaScriptTooling,
  renderMain,
  renderTemplateFile,
  renderPackageJson
} from './project-render.js'

describe('project render', () => {
  it('renders package variants and main entrypoints', () => {
    const template = JSON.stringify({
      scripts: { build: 'tsc', start: 'node dist/main.js', typecheck: 'tsc' },
      devDependencies: {
        '@types/node': '1',
        typescript: '5',
        'typescript-eslint': '8'
      },
      dependencies: { '@mcp-kit/node': '1' }
    })

    expect(
      renderPackageJson(template, {
        transport: 'stdio',
        quality: 'off',
        language: 'javascript',
        packageManager: 'bun',
        git: false,
        hooks: false,
        ci: false,
        install: false,
        agent: 'none',
        force: false,
        dryRun: false
      })
    ).not.toContain('devDependencies')
    expect(
      renderPackageJson(
        JSON.stringify({
          scripts: { test: 'vitest run' },
          dependencies: { '@mcp-kit/node': '1' }
        }),
        {
          transport: 'http',
          quality: 'standard',
          language: 'typescript',
          packageManager: 'pnpm',
          git: false,
          hooks: false,
          ci: false,
          install: false,
          agent: 'none',
          force: false,
          dryRun: false
        }
      )
    ).toContain('"test": "vitest run"')
    expect(renderMain('stdio')).toContain('await startStdio()')
    expect(renderMain('http')).toContain('await startHttp()')
    expect(renderMain('both')).toContain("transport === 'http'")
  })

  it('renders javascript tooling and transport-aware template files', () => {
    expect(
      renderJavaScriptTooling(
        'knip.json',
        JSON.stringify({ entry: 'src/main.ts' })
      )
    ).toContain('"entry": []')
    expect(
      renderJavaScriptTooling('vitest.config.js', "import './a.ts'\n")
    ).toContain('./a.js')

    expect(
      renderTemplateFile(
        {
          path: 'src/server/transports/stdio.ts',
          content: 'export const stdio = true\n'
        },
        {
          projectName: 'server',
          options: {
            transport: 'http',
            quality: 'standard',
            language: 'typescript',
            packageManager: 'pnpm',
            git: false,
            hooks: false,
            ci: false,
            install: false,
            agent: 'none',
            force: false,
            dryRun: false
          }
        }
      )
    ).toBeUndefined()

    expect(
      renderTemplateFile(
        {
          path: 'src/server/transports/http.ts',
          content: 'export const http = true\n'
        },
        {
          projectName: 'server',
          options: {
            transport: 'stdio',
            quality: 'standard',
            language: 'typescript',
            packageManager: 'pnpm',
            git: false,
            hooks: false,
            ci: false,
            install: false,
            agent: 'none',
            force: false,
            dryRun: false
          }
        }
      )
    ).toBeUndefined()

    const qualityConfig = renderTemplateFile(
      {
        path: 'quality.config.js',
        content: ''
      },
      {
        projectName: 'server',
        options: {
          transport: 'stdio',
          quality: 'standard',
          language: 'typescript',
          packageManager: 'pnpm',
          git: false,
          hooks: false,
          ci: false,
          install: false,
          agent: 'none',
          force: false,
          dryRun: false
        }
      }
    )
    expect(qualityConfig).toBeDefined()
    expect(qualityConfig?.content).toContain(
      "architecture: { command: 'npm run test:architecture --if-present' }"
    )

    expect(
      renderTemplateFile(
        {
          path: 'src/main.ts',
          content: "console.log('{{PROJECT_NAME}}')\n"
        },
        {
          projectName: 'server',
          options: {
            transport: 'stdio',
            quality: 'standard',
            language: 'javascript',
            packageManager: 'pnpm',
            git: false,
            hooks: false,
            ci: false,
            install: false,
            agent: 'none',
            force: false,
            dryRun: false
          }
        }
      )
    ).toMatchObject({ path: 'src/main.js' })
  })

  it('renders ci workflow and agent-specific files', () => {
    expect(ciWorkflowContent('pnpm')).toContain(
      'corepack pnpm run quality:full'
    )
    expect(ciWorkflowContent('npm')).toContain('npm run quality:full')
    expect(agentFiles('generic')).toEqual([
      {
        path: 'AGENTS.md',
        content: '# Agent Instructions\n\nUse mcp-kit conventions.\n'
      }
    ])
    expect(agentFiles('codex')).toEqual([
      { path: 'AGENTS.md', content: '# Codex\n\nUse mcp-kit conventions.\n' }
    ])
  })
})
