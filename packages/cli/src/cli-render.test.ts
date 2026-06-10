import { describe, expect, it } from 'vitest'

import {
  agentFiles,
  capabilityContent,
  ciWorkflowContent,
  renderJavaScriptTooling,
  renderMain,
  renderPackageJson,
  renderTemplateFile
} from './cli-render.js'

describe('cli renderers', () => {
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
      renderPackageJson('{}', {
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
      })
    ).toContain('"scripts"')
    expect(renderMain('stdio')).toContain('await startStdio()')
    expect(renderMain('http')).toContain('HTTP transport')
    expect(renderMain('both')).toContain('MCP_TRANSPORT')
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

  it('renders capabilities, ci workflow and agent-specific files', () => {
    expect(capabilityContent('tool', 'getUserTool')).toContain('defineTool')
    expect(capabilityContent('resource', 'profileResource')).toContain(
      'defineResource'
    )
    expect(capabilityContent('prompt', 'reviewPrompt')).toContain(
      'definePrompt'
    )
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
