import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { analyzeProject, exitCodes, runCli } from './index.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('mcp-kit cli', () => {
  it('creates a new TypeScript stdio project', async () => {
    const cwd = await makeTemp()
    const output = createOutput()

    const exitCode = await runCli(
      ['new', 'My Server', '--yes', '--no-install', '--json'],
      {
        cwd,
        stdout: output.stdout,
        stderr: output.stderr
      }
    )

    expect(exitCode).toBe(exitCodes.ok)
    const target = resolve(cwd, 'My Server')
    const packageJson = JSON.parse(
      await readFile(resolve(target, 'package.json'), 'utf8')
    ) as { name: string }
    expect(packageJson.name).toBe('my-server')
    await expect(
      readFile(resolve(target, '.mcp-kit/manifest.json'), 'utf8')
    ).resolves.toContain('"template": "default"')
    expect(JSON.parse(output.out) as { ok: boolean }).toMatchObject({
      ok: true,
      command: 'new'
    })
  })

  it('prints help and machine-readable errors', async () => {
    const cwd = await makeTemp()
    const help = createOutput()
    await expect(
      runCli(['--help'], {
        cwd,
        stdout: help.stdout,
        stderr: help.stderr
      })
    ).resolves.toBe(exitCodes.ok)
    expect(help.out).toContain('Usage: mcp-kit')

    const unknown = createOutput()
    await expect(
      runCli(['missing', '--json'], {
        cwd,
        stdout: unknown.stdout,
        stderr: unknown.stderr
      })
    ).resolves.toBe(exitCodes.usage)
    expect(JSON.parse(unknown.out)).toMatchObject({
      ok: false,
      error: { exitCode: exitCodes.usage }
    })

    const invalid = createOutput()
    await expect(
      runCli(['new', 'server', '--transport', 'ftp', '--json'], {
        cwd,
        stdout: invalid.stdout,
        stderr: invalid.stderr
      })
    ).resolves.toBe(exitCodes.validation)
    expect(JSON.parse(invalid.out)).toMatchObject({
      ok: false,
      error: { exitCode: exitCodes.validation }
    })
  })

  it('validates required positional arguments', async () => {
    const cwd = await makeTemp()

    await expect(runCli(['new'], { cwd })).resolves.toBe(exitCodes.usage)
    await expect(runCli(['add', 'bad', 'name'], { cwd })).resolves.toBe(
      exitCodes.usage
    )
    await expect(runCli(['add', 'tool'], { cwd })).resolves.toBe(
      exitCodes.usage
    )
  })

  it('generates async tool lifecycle scaffolding', async () => {
    const cwd = await makeTemp()
    await runCli(['new', 'async-server', '--yes', '--no-install', '--no-ci'], {
      cwd
    })

    const project = resolve(cwd, 'async-server')
    await expect(
      runCli(['add', 'tool', 'sync-report', '--async'], { cwd: project })
    ).resolves.toBe(exitCodes.ok)

    await expect(
      readFile(
        resolve(project, 'src/features/sync-report/mcp/sync-report.tool.ts'),
        'utf8'
      )
    ).resolves.toContain('createAsyncJobOperation')
    await expect(
      readFile(resolve(project, 'src/mcp/registry.ts'), 'utf8')
    ).resolves.toContain('startSyncReportTool')
    await expect(
      readFile(
        resolve(project, 'test/contracts/sync-report.tool.contract.test.ts'),
        'utf8'
      )
    ).resolves.toContain(
      "expect(startSyncReportTool.name).toBe('start-sync-report')"
    )
  })

  it('creates the JavaScript variant without TypeScript config', async () => {
    const cwd = await makeTemp()

    expect(
      await runCli(
        [
          'new',
          'js-server',
          '--yes',
          '--language',
          'javascript',
          '--no-install',
          '--no-ci'
        ],
        { cwd }
      )
    ).toBe(exitCodes.ok)

    const target = resolve(cwd, 'js-server')
    await expect(
      readFile(resolve(target, 'src/main.js'), 'utf8')
    ).resolves.toContain('startStdio')
    const generatedDomain = await readFile(
      resolve(target, 'src/features/health/domain/health-status.js'),
      'utf8'
    ).catch(() => '')
    expect(generatedDomain).not.toContain('export type')
    expect(generatedDomain).not.toContain("status: 'ok'")
    await expect(
      readFile(resolve(target, 'src/features/health/index.js'), 'utf8')
    ).resolves.not.toContain('export type')
    await expect(
      readFile(resolve(target, 'tsconfig.json'), 'utf8')
    ).rejects.toThrow()
    await expect(
      readFile(resolve(target, 'eslint.smells.config.js'), 'utf8')
    ).resolves.not.toContain('typescript-eslint')
  })

  it('renders transport, quality, package manager and agent variants', async () => {
    const cwd = await makeTemp()

    await expect(
      runCli(
        [
          'new',
          'strict-both',
          '--yes',
          '--transport',
          'both',
          '--quality',
          'strict',
          '--package-manager',
          'npm',
          '--agent',
          'cursor',
          '--no-install'
        ],
        { cwd }
      )
    ).resolves.toBe(exitCodes.ok)
    const both = resolve(cwd, 'strict-both')
    await expect(
      readFile(resolve(both, 'src/main.ts'), 'utf8')
    ).resolves.toContain('MCP_TRANSPORT')
    await expect(
      readFile(resolve(both, 'package.json'), 'utf8')
    ).resolves.toContain('"packageManager": "npm@11.4.2"')
    await expect(
      readFile(resolve(both, '.cursor/rules/mcp-kit.md'), 'utf8')
    ).resolves.toContain('mcp-kit')
    await expect(
      readFile(resolve(both, '.githooks/pre-commit'), 'utf8')
    ).resolves.toContain('quality:fast')
    await expect(
      readFile(resolve(both, '.githooks/pre-push'), 'utf8')
    ).resolves.toContain('quality:full')
    await expect(
      readFile(resolve(both, 'dependency-cruiser.config.cjs'), 'utf8')
    ).resolves.toContain('no-orphan-modules')
    await expect(
      readFile(resolve(both, 'quality.config.js'), 'utf8')
    ).resolves.toContain('eslint --config eslint.smells.config.js')
    await expect(
      readFile(resolve(both, 'quality.config.js'), 'utf8')
    ).resolves.toContain(
      "architecture: { command: 'npm run test:architecture --if-present' }"
    )
    await expect(
      readFile(resolve(both, 'eslint.smells.config.js'), 'utf8')
    ).resolves.toContain('eslint-plugin-sonarjs')
    const strictDependencies = (await import(
      pathToFileURL(resolve(both, 'dependency-cruiser.config.cjs')).href
    )) as { default: { forbidden: readonly { name: string }[] } }
    expect(
      strictDependencies.default.forbidden.map(({ name }) => name)
    ).toContain('no-orphan-modules')
    await expect(
      readFile(resolve(both, '.github/workflows/ci.yml'), 'utf8')
    ).resolves.toContain('quality:full')
    await expect(
      readFile(resolve(both, 'package.json'), 'utf8')
    ).resolves.toContain('"test:architecture": "vitest run test/architecture"')

    await expect(
      runCli(
        [
          'new',
          'http-only',
          '--yes',
          '--transport',
          'http',
          '--agent',
          'claude',
          '--no-install'
        ],
        { cwd }
      )
    ).resolves.toBe(exitCodes.ok)
    const http = resolve(cwd, 'http-only')
    await expect(
      readFile(resolve(http, 'src/main.ts'), 'utf8')
    ).resolves.toContain('await startHttp()')
    await expect(
      readFile(resolve(http, 'src/server/transports/http.ts'), 'utf8')
    ).resolves.toContain('runStreamableHttp(createApp')
    await expect(
      readFile(resolve(http, 'src/server/transports/stdio.ts'), 'utf8')
    ).rejects.toThrow()
    await expect(
      readFile(resolve(http, 'CLAUDE.md'), 'utf8')
    ).resolves.toContain('Claude')
    await expect(
      readFile(resolve(http, 'dependency-cruiser.config.cjs'), 'utf8')
    ).resolves.not.toContain('no-orphan-modules')

    await expect(
      runCli(
        [
          'new',
          'dry',
          '--yes',
          '--dry-run',
          '--package-manager',
          'yarn',
          '--agent',
          'generic',
          '--no-hooks',
          '--no-ci',
          '--no-install'
        ],
        { cwd }
      )
    ).resolves.toBe(exitCodes.ok)
    await expect(
      readFile(resolve(cwd, 'dry/package.json'), 'utf8')
    ).rejects.toThrow()
  })

  it('keeps every official template variant architecture-valid', async () => {
    const cwd = await makeTemp()
    const transports = ['stdio', 'http', 'both'] as const
    const qualities = ['off', 'standard', 'strict'] as const
    const languages = ['typescript', 'javascript'] as const

    for (const transport of transports) {
      for (const quality of qualities) {
        for (const language of languages) {
          const name = `${transport}-${quality}-${language}`
          await expect(
            runCli(
              [
                'new',
                name,
                '--transport',
                transport,
                '--quality',
                quality,
                '--language',
                language,
                '--no-install',
                '--no-ci',
                '--no-hooks'
              ],
              { cwd }
            )
          ).resolves.toBe(exitCodes.ok)
          await expect(
            analyzeProject(resolve(cwd, name))
          ).resolves.toMatchObject({ diagnostics: [] })
        }
      }
    }
  })

  it('keeps generated source architecture identical across quality presets', async () => {
    const cwd = await makeTemp()
    const transports = ['stdio', 'http', 'both'] as const
    const qualities = ['off', 'standard', 'strict'] as const
    const languages = ['typescript', 'javascript'] as const

    for (const transport of transports) {
      for (const language of languages) {
        const snapshots = new Map<string, readonly string[]>()

        for (const quality of qualities) {
          const name = `${transport}-${quality}-${language}-shape`
          await expect(
            runCli(
              [
                'new',
                name,
                '--transport',
                transport,
                '--quality',
                quality,
                '--language',
                language,
                '--no-install',
                '--no-ci',
                '--no-hooks'
              ],
              { cwd }
            )
          ).resolves.toBe(exitCodes.ok)

          snapshots.set(
            quality,
            await snapshotProjectFiles(resolve(cwd, name, 'src'), {
              [name]: `${transport}-${language}-shape`
            })
          )
        }

        expect(snapshots.get('off')).toEqual(snapshots.get('standard'))
        expect(snapshots.get('off')).toEqual(snapshots.get('strict'))
      }
    }
  })

  it('runs quality with JSON reporting and propagates its status', async () => {
    const cwd = await makeTemp()
    const output = createOutput()
    await writeFile(resolve(cwd, 'package.json'), '{"type":"module"}')
    await writeFile(
      resolve(cwd, 'quality.config.js'),
      "export default { preset: 'off', dependencyCruiser: { enabled: false, command: '' }, tests: { unit: { enabled: false, command: '' } }, build: { enabled: false, command: '' } }\n"
    )

    await expect(
      runCli(['quality', '--full', '--json'], {
        cwd,
        stdout: output.stdout,
        stderr: output.stderr
      })
    ).resolves.toBe(exitCodes.ok)
    expect(JSON.parse(output.out)).toMatchObject({
      ok: true,
      command: 'quality',
      quality: { mode: 'full', preset: 'off', status: 'passed' }
    })
    await expect(runCli(['quality'], { cwd })).resolves.toBe(exitCodes.usage)
  })

  it('supports release quality mode and rejects multiple mode flags', async () => {
    const cwd = await makeTemp()
    const output = createOutput()
    await mkdir(resolve(cwd, 'packages/core/src'), { recursive: true })
    await mkdir(resolve(cwd, 'packages/core/dist'), { recursive: true })
    await writeFile(
      resolve(cwd, 'package.json'),
      JSON.stringify({ name: 'repo', private: true, version: '1.2.3' })
    )
    await writeFile(
      resolve(cwd, 'CHANGELOG.md'),
      '# Changelog\n\n## [Unreleased]\n'
    )
    await writeFile(
      resolve(cwd, 'packages/core/package.json'),
      JSON.stringify({
        name: '@mcp-kit/core',
        version: '1.2.3',
        type: 'module',
        exports: {
          '.': {
            types: './dist/index.d.ts',
            import: './dist/index.js'
          }
        },
        files: ['dist', 'README.md']
      })
    )
    await writeFile(resolve(cwd, 'packages/core/README.md'), '# core\n')
    await writeFile(
      resolve(cwd, 'packages/core/dist/index.js'),
      "export const packageInfo = { name: '@mcp-kit/core', version: '1.2.3' }\n"
    )
    await writeFile(
      resolve(cwd, 'packages/core/dist/index.d.ts'),
      "export declare const packageInfo: { readonly name: '@mcp-kit/core'; readonly version: '1.2.3' }\n"
    )
    await writeFile(
      resolve(cwd, 'packages/core/src/index.ts'),
      "export const packageInfo = {\n  name: '@mcp-kit/core',\n  version: '1.2.3'\n} as const\n"
    )
    await writeFile(
      resolve(cwd, 'quality.config.js'),
      "export default { preset: 'off', dependencyCruiser: { enabled: false, command: '' }, tests: { unit: { enabled: false, command: '' } }, build: { enabled: false, command: '' } }\n"
    )
    await initializeGitRepository(cwd)

    await expect(
      runCli(['quality', '--release', '--json'], {
        cwd,
        stdout: output.stdout,
        stderr: output.stderr
      })
    ).resolves.toBe(exitCodes.ok)
    expect(JSON.parse(output.out)).toMatchObject({
      ok: true,
      command: 'quality',
      quality: { mode: 'release', preset: 'off', status: 'passed' }
    })

    await expect(
      runCli(['quality', '--full', '--release'], { cwd })
    ).resolves.toBe(exitCodes.usage)
  }, 20_000)

  it('supports mutation quality mode as a dedicated pipeline', async () => {
    const cwd = await makeTemp()
    const output = createOutput()
    await writeFile(
      resolve(cwd, 'quality.config.js'),
      `export default {
  preset: 'off',
  formatting: { enabled: false, command: '' },
  lint: { enabled: false, command: '', typed: false },
  smells: { enabled: false, command: '' },
  typecheck: { enabled: false, command: '' },
  deadCode: { enabled: false, command: '' },
  dependencyCruiser: { enabled: false, command: '' },
  tests: {
    unit: { enabled: false, command: '' },
    integration: { enabled: false, command: '' },
    contract: { enabled: false, command: '' },
    architecture: { enabled: false, command: '' }
  },
  coverage: { enabled: false, command: '' },
  build: { enabled: false, command: '' },
  mutation: { command: 'node -e "process.exit(0)"' }
}
`
    )

    await expect(
      runCli(['quality', '--mutation', '--json'], {
        cwd,
        stdout: output.stdout,
        stderr: output.stderr
      })
    ).resolves.toBe(exitCodes.ok)
    expect(JSON.parse(output.out)).toMatchObject({
      ok: true,
      command: 'quality',
      quality: { mode: 'mutation', preset: 'off', status: 'passed' }
    })

    await expect(
      runCli(['quality', '--full', '--mutation'], { cwd })
    ).resolves.toBe(exitCodes.usage)
  })

  it('prepares a release through the release command without publishing', async () => {
    const cwd = await makeTemp()
    const output = createOutput()
    await mkdir(resolve(cwd, 'packages/core/src'), { recursive: true })
    await mkdir(resolve(cwd, 'packages/core/dist'), { recursive: true })
    await writeFile(
      resolve(cwd, 'package.json'),
      JSON.stringify({ name: 'repo', private: true, version: '1.2.3' })
    )
    await writeFile(
      resolve(cwd, 'CHANGELOG.md'),
      '# Changelog\n\n## [Unreleased]\n'
    )
    await writeFile(
      resolve(cwd, 'packages/core/package.json'),
      JSON.stringify({
        name: '@mcp-kit/core',
        version: '1.2.3',
        type: 'module',
        exports: {
          '.': {
            types: './dist/index.d.ts',
            import: './dist/index.js'
          }
        },
        files: ['dist', 'README.md']
      })
    )
    await writeFile(resolve(cwd, 'packages/core/README.md'), '# core\n')
    await writeFile(
      resolve(cwd, 'packages/core/dist/index.js'),
      "export const packageInfo = { name: '@mcp-kit/core', version: '1.2.3' }\n"
    )
    await writeFile(
      resolve(cwd, 'packages/core/dist/index.d.ts'),
      "export declare const packageInfo: { readonly name: '@mcp-kit/core'; readonly version: '1.2.3' }\n"
    )
    await writeFile(
      resolve(cwd, 'packages/core/src/index.ts'),
      "export const packageInfo = {\n  name: '@mcp-kit/core',\n  version: '1.2.3'\n} as const\n"
    )
    await writeFile(
      resolve(cwd, 'quality.config.js'),
      "export default { preset: 'off', dependencyCruiser: { enabled: false, command: '' }, tests: { unit: { enabled: false, command: '' } }, build: { enabled: false, command: '' } }\n"
    )
    await initializeGitRepository(cwd)

    await expect(
      runCli(['release', '--json'], {
        cwd,
        stdout: output.stdout,
        stderr: output.stderr
      })
    ).resolves.toBe(exitCodes.ok)
    expect(JSON.parse(output.out)).toMatchObject({
      ok: true,
      command: 'release',
      quality: { mode: 'release', preset: 'off', status: 'passed' },
      release: { status: 'prepared' }
    })
  }, 20_000)

  it('prints quality diagnostics and coverage exclusions in text mode', async () => {
    const cwd = await makeTemp()
    await writeFile(
      resolve(cwd, 'quality.config.js'),
      `export default {
  preset: 'standard',
  formatting: { command: 'node -e "setTimeout(() => {}, 1100)"' },
  lint: { enabled: false, command: '' },
  typecheck: { enabled: false, command: '' },
  dependencyCruiser: { enabled: false, command: '' },
  tests: { unit: { enabled: false, command: '' } },
  coverage: {
    exclude: [{ pattern: 'src/generated.ts', reason: 'generated' }]
  },
  build: { enabled: false, command: '' }
}
`
    )
    await mkdir(resolve(cwd, 'src/features/broken/domain'), {
      recursive: true
    })
    await writeFile(
      resolve(cwd, 'src/features/broken/domain/value.ts'),
      "import '@modelcontextprotocol/sdk/types.js'\n"
    )
    const output = createOutput()

    await expect(
      runCli(['quality', '--fast', '--since', 'main'], {
        cwd,
        stdout: output.stdout,
        stderr: output.stderr
      })
    ).resolves.toBe(exitCodes.validation)

    expect(output.out).toContain('[failed] architecture')
    expect(output.out).toContain(
      'src/features/broken/domain/value.ts:1 no-mcp-sdk-in-policy'
    )
    expect(output.out).toContain(
      '[coverage-exclusion] src/generated.ts: generated'
    )
    expect(output.out).toContain('quality failed in ')
  })

  it('aborts a running quality command on SIGINT', async () => {
    const cwd = await makeTemp()
    await writeFile(
      resolve(cwd, 'quality.config.js'),
      `export default {
  preset: 'standard',
  formatting: { command: 'node -e "setTimeout(() => {}, 10000)"' },
  lint: { enabled: false, command: '' },
  typecheck: { enabled: false, command: '' },
  dependencyCruiser: { enabled: false, command: '' },
  tests: { unit: { enabled: false, command: '' } },
  build: { enabled: false, command: '' }
}
`
    )
    const output = createOutput()
    const running = runCli(['quality', '--fast'], {
      cwd,
      stdout: output.stdout,
      stderr: output.stderr
    })

    setTimeout(() => {
      process.emit('SIGINT')
    }, 50)

    await expect(running).resolves.toBe(exitCodes.validation)
    expect(output.out).toContain('[failed] format')
  })

  it('refuses to create into a non-empty target without force', async () => {
    const cwd = await makeTemp()
    const target = resolve(cwd, 'existing')
    await writeFile(resolve(cwd, 'marker'), 'parent')
    await runCli(['new', 'existing', '--yes', '--no-install'], { cwd })
    await writeFile(resolve(target, 'owned-by-user.txt'), 'keep')

    const exitCode = await runCli(['new', 'existing', '--yes'], { cwd })

    expect(exitCode).toBe(exitCodes.conflict)

    await expect(
      runCli(['new', 'existing', '--yes', '--force', '--no-install'], { cwd })
    ).resolves.toBe(exitCodes.ok)
  })

  it('refuses to create when the target is an existing file', async () => {
    const cwd = await makeTemp()
    await writeFile(resolve(cwd, 'server'), 'file')

    await expect(runCli(['new', 'server', '--yes'], { cwd })).resolves.toBe(
      exitCodes.conflict
    )
  })

  it('initializes an existing package idempotently', async () => {
    const cwd = await makeTemp()
    await writeFile(
      resolve(cwd, 'package.json'),
      JSON.stringify({ name: 'existing', type: 'module', scripts: {} })
    )

    expect(
      await runCli(['init', '--yes', '--no-install', '--no-ci'], { cwd })
    ).toBe(exitCodes.ok)
    const first = await readFile(resolve(cwd, '.mcp-kit/manifest.json'), 'utf8')
    expect(
      await runCli(['init', '--yes', '--no-install', '--no-ci'], { cwd })
    ).toBe(exitCodes.ok)
    const second = await readFile(
      resolve(cwd, '.mcp-kit/manifest.json'),
      'utf8'
    )

    expect(second).toBe(first)
  })

  it('supports init dry-run, explicit root and force for non-package directories', async () => {
    const cwd = await makeTemp()
    const root = resolve(cwd, 'repo')
    await mkdir(root)
    await writeFile(resolve(cwd, 'root-marker'), 'x')
    await writeFile(
      resolve(cwd, 'package.json'),
      JSON.stringify({ name: 'root' })
    )
    await writeFile(resolve(cwd, 'pnpm-lock.yaml'), '')
    await writeFile(resolve(cwd, 'tsconfig.json'), '{}')
    await writeFile(resolve(root, 'repo-marker'), 'x')
    await runCli(['init', '--root', 'repo', '--force', '--dry-run'], { cwd })
    await expect(
      readFile(resolve(root, '.mcp-kit/manifest.json'), 'utf8')
    ).rejects.toThrow()

    await expect(runCli(['init', '--here'], { cwd: root })).resolves.toBe(
      exitCodes.conflict
    )
    await expect(
      runCli(['init', '--here', '--force', '--yes', '--no-ci'], { cwd: root })
    ).resolves.toBe(exitCodes.ok)
    await expect(
      readFile(resolve(root, '.mcp-kit/manifest.json'), 'utf8')
    ).resolves.toContain('"templateVersion": "0.0.0"')
  })

  it('adds a tool and updates the explicit registry', async () => {
    const cwd = await makeTemp()
    await runCli(['new', 'server', '--yes', '--no-install', '--no-ci'], { cwd })
    const root = resolve(cwd, 'server')

    expect(await runCli(['add', 'tool', 'get-user'], { cwd: root })).toBe(
      exitCodes.ok
    )

    await expect(
      readFile(
        resolve(root, 'src/features/get-user/mcp/get-user.tool.ts'),
        'utf8'
      )
    ).resolves.toContain('getUserTool')
    await expect(
      readFile(resolve(root, 'src/mcp/registry.ts'), 'utf8')
    ).resolves.toContain('getUserTool')
  })

  it('adds resources and prompts', async () => {
    const cwd = await makeTemp()
    await runCli(['new', 'server', '--yes', '--no-install', '--no-ci'], { cwd })
    const root = resolve(cwd, 'server')

    expect(await runCli(['add', 'resource', 'profile'], { cwd: root })).toBe(
      exitCodes.ok
    )
    expect(await runCli(['add', 'prompt', 'review-user'], { cwd: root })).toBe(
      exitCodes.ok
    )

    await expect(
      readFile(resolve(root, 'src/mcp/registry.ts'), 'utf8')
    ).resolves.toContain('profileResource')
    await expect(
      readFile(resolve(root, 'src/mcp/registry.ts'), 'utf8')
    ).resolves.toContain('reviewUserPrompt')
  })

  it('handles idempotent add updates and JavaScript projects', async () => {
    const cwd = await makeTemp()
    await runCli(
      [
        'new',
        'server',
        '--yes',
        '--language',
        'javascript',
        '--no-install',
        '--no-ci'
      ],
      { cwd }
    )
    const root = resolve(cwd, 'server')

    await expect(
      runCli(['add', 'tool', 'get-user'], { cwd: root })
    ).resolves.toBe(exitCodes.ok)
    await expect(
      runCli(['add', 'tool', 'get-user'], { cwd: root })
    ).resolves.toBe(exitCodes.ok)

    await expect(
      readFile(
        resolve(root, 'src/features/get-user/mcp/get-user.tool.js'),
        'utf8'
      )
    ).resolves.toContain('getUserTool')

    await expect(
      runCli(['add', 'resource', 'dry-run-resource', '--dry-run'], {
        cwd: root
      })
    ).resolves.toBe(exitCodes.ok)
    await expect(
      readFile(
        resolve(
          root,
          'src/features/dry-run-resource/mcp/dry-run-resource.resource.js'
        ),
        'utf8'
      )
    ).rejects.toThrow()
  })

  it('reports doctor diagnostics as JSON', async () => {
    const cwd = await makeTemp()
    await runCli(['new', 'server', '--yes', '--no-install'], { cwd })
    const output = createOutput()

    const exitCode = await runCli(['doctor', '--json'], {
      cwd: resolve(cwd, 'server'),
      stdout: output.stdout,
      stderr: output.stderr
    })

    expect(exitCode).toBe(exitCodes.ok)
    const report = JSON.parse(output.out) as {
      ok: boolean
      diagnostics: { code: string }[]
    }
    expect(report.ok).toBe(true)
    expect(report.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'registry'
    )
  })

  it('reports doctor diagnostics in text mode', async () => {
    const cwd = await makeTemp()
    await runCli(['new', 'server', '--yes', '--no-install'], { cwd })
    const output = createOutput()

    await expect(
      runCli(['doctor'], {
        cwd: resolve(cwd, 'server'),
        stdout: output.stdout,
        stderr: output.stderr
      })
    ).resolves.toBe(exitCodes.ok)

    expect(output.out).toContain('[ok] node-version')
    expect(output.out).toContain('[ok] package-manager')
  })

  it('reports doctor warnings and errors in text mode', async () => {
    const cwd = await makeTemp()
    await writeFile(
      resolve(cwd, 'package.json'),
      JSON.stringify({ name: 'broken', scripts: {} })
    )
    await writeFile(
      resolve(cwd, 'mcp-kit.config.ts'),
      "export default { boundedContext: 'all', transport: 'http', store: 'inMemory' }\n"
    )
    const output = createOutput()
    const originalEnv = process.env['NODE_ENV']
    process.env['NODE_ENV'] = 'production'

    await expect(
      runCli(['doctor', '--here'], {
        cwd,
        stdout: output.stdout,
        stderr: output.stderr
      })
    ).resolves.toBe(exitCodes.ok)
    if (originalEnv === undefined) {
      delete process.env['NODE_ENV']
    } else {
      process.env['NODE_ENV'] = originalEnv
    }

    expect(output.out).toContain('[warning] scripts: start script is missing')
    expect(output.out).toContain(
      '[error] registry: src/mcp/registry.ts is missing'
    )
    expect(output.out).toContain('[error] http-security')
    expect(output.out).toContain('[warning] bounded-context')
  })

  it('reports doctor drift, invalid configs and unsafe stdout', async () => {
    const cwd = await makeTemp()
    await mkdir(resolve(cwd, 'src/mcp'), { recursive: true })
    await mkdir(resolve(cwd, 'src/server/transports'), { recursive: true })
    await mkdir(resolve(cwd, '.mcp-kit'), { recursive: true })
    await writeFile(resolve(cwd, 'package.json'), '{invalid')
    await writeFile(resolve(cwd, 'src/mcp/registry.ts'), 'export const x = []')
    await writeFile(
      resolve(cwd, 'src/server/transports/stdio.ts'),
      'console.log("bad")\n'
    )
    await writeFile(
      resolve(cwd, '.mcp-kit/manifest.json'),
      JSON.stringify({
        files: [
          { path: 'missing.txt', checksum: 'x' },
          { path: 'src/mcp/registry.ts', checksum: 'wrong' },
          { path: 'package.json' },
          'ignored'
        ]
      })
    )
    const output = createOutput()

    await expect(
      runCli(['doctor', '--here'], {
        cwd,
        stdout: output.stdout,
        stderr: output.stderr
      })
    ).resolves.toBe(exitCodes.ok)

    expect(output.out).toContain('package.json is missing or invalid')
    expect(output.out).toContain('registry does not use defineRegistry')
    expect(output.out).toContain('Manifest drift: 1 missing, 1 modified')
    expect(output.out).toContain('stdio transport writes application output')
  })

  it('maps unexpected command failures to internal errors', async () => {
    const output = createOutput()

    await expect(
      runCli(['doctor', '--json'], {
        cwd: '\0',
        stdout: output.stdout,
        stderr: output.stderr
      })
    ).resolves.toBe(exitCodes.internal)

    expect(JSON.parse(output.out)).toMatchObject({
      ok: false,
      error: { exitCode: exitCodes.internal }
    })
  })
})

async function makeTemp(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'mcp-kit-cli-'))
  temporaryDirectories.push(directory)
  return directory
}

async function snapshotProjectFiles(
  root: string,
  replacements: Readonly<Record<string, string>> = {}
): Promise<readonly string[]> {
  const files: string[] = []
  await collectProjectFiles(root, root, files, replacements)
  return files.sort()
}

async function collectProjectFiles(
  root: string,
  current: string,
  files: string[],
  replacements: Readonly<Record<string, string>>
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true })

  for (const entry of entries) {
    const path = resolve(current, entry.name)

    if (entry.isDirectory()) {
      await collectProjectFiles(root, path, files, replacements)
      continue
    }

    const relative = path.slice(root.length + 1)
    const content = normalizeSnapshot(
      await readFile(path, 'utf8'),
      replacements
    )
    files.push(`${relative}\n${content}`)
  }
}

function normalizeSnapshot(
  content: string,
  replacements: Readonly<Record<string, string>>
): string {
  let normalized = content

  for (const [from, to] of Object.entries(replacements)) {
    normalized = normalized.split(from).join(to)
  }

  return normalized
}

function createOutput(): {
  stdout: { write(chunk: string): boolean }
  stderr: { write(chunk: string): boolean }
  out: string
  err: string
} {
  const output = {
    out: '',
    err: '',
    stdout: {
      write(chunk: string): boolean {
        output.out += chunk
        return true
      }
    },
    stderr: {
      write(chunk: string): boolean {
        output.err += chunk
        return true
      }
    }
  }
  return output
}

async function initializeGitRepository(root: string): Promise<void> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  await execFileAsync('git', ['init'], { cwd: root })
  await execFileAsync('git', ['config', 'user.name', 'Test User'], {
    cwd: root
  })
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], {
    cwd: root
  })
  await execFileAsync('git', ['add', '.'], { cwd: root })
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: root })
}
