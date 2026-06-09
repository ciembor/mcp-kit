import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { analyzeProject, exitCodes, internals, runCli } from './index.js'

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
    ).resolves.toContain('HTTP transport is not implemented')
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
    expect(internals.errorMessage(new Error('typed'))).toBe('typed')
    expect(internals.errorMessage('raw')).toBe('raw')
  })

  it('covers parser and generator internals for merge and validation paths', async () => {
    const cwd = await makeTemp()
    await writeFile(resolve(cwd, 'package.json'), '{"scripts":{"keep":"keep"}}')
    await writeFile(resolve(cwd, 'config.json'), '{"a":{"b":1}}')
    await writeFile(resolve(cwd, 'ci.yaml'), 'name: old\n')
    await writeFile(resolve(cwd, 'text.txt'), 'old\n')
    await writeFile(resolve(cwd, 'yarn.lock'), '')

    expect(
      internals.parseArgs(['new', 'app', '--json', '--quality=strict'])
    ).toEqual({
      command: 'new',
      positionals: ['app'],
      options: { json: true, quality: 'strict' }
    })
    expect(internals.parseArgs(['--'])).toEqual({
      positionals: [],
      options: {}
    })
    expect(internals.parseArgs([undefined as unknown as string])).toEqual({
      positionals: [],
      options: {}
    })
    expect(internals.detectPackageManager(cwd)).toBe('yarn')
    await rm(resolve(cwd, 'yarn.lock'))
    await writeFile(resolve(cwd, 'bun.lockb'), '')
    expect(internals.detectPackageManager(cwd)).toBe('bun')
    await rm(resolve(cwd, 'bun.lockb'))
    await writeFile(resolve(cwd, 'package-lock.json'), '')
    expect(internals.detectPackageManager(cwd)).toBe('npm')
    await rm(resolve(cwd, 'package-lock.json'))
    await writeFile(resolve(cwd, 'pnpm-lock.yaml'), '')
    expect(internals.detectPackageManager(cwd)).toBe('pnpm')
    expect(await internals.detectLanguage(cwd)).toBe('javascript')
    await writeFile(
      resolve(cwd, 'package.json'),
      '{"devDependencies":{"typescript":"5"}}'
    )
    expect(await internals.detectLanguage(cwd)).toBe('typescript')
    expect(() => internals.toPackageName('!!!')).toThrow(
      'Cannot derive a package name'
    )
    expect(internals.toPackageName('---Server---')).toBe('server')

    const packageMerge = await internals.createOrMergeOperation(
      cwd,
      'package.json',
      '{"scripts":{"start":"node index.js"},"dependencies":{"x":"1"}}'
    )
    expect(packageMerge.kind).toBe('merge-package')
    expect(packageMerge.content).toContain('"start": "node index.js"')

    const jsonMerge = await internals.createOrMergeOperation(
      cwd,
      'config.json',
      '{"a":{"c":2}}'
    )
    expect(jsonMerge.kind).toBe('merge-json')
    expect(jsonMerge.content).toContain('"c": 2')

    const yamlMerge = await internals.createOrMergeOperation(
      cwd,
      'ci.yaml',
      'name: new\n'
    )
    expect(yamlMerge.kind).toBe('merge-yaml')
    expect(yamlMerge.content).toContain('>>>>>>> mcp-kit')
    await expect(
      internals.createOrMergeOperation(cwd, 'ci.yaml', 'name: old\n')
    ).resolves.toMatchObject({
      kind: 'create',
      content: 'name: old\n'
    })
    const conflict = await internals.createOrMergeOperation(
      cwd,
      'text.txt',
      'new\n'
    )
    expect(conflict.kind).toBe('conflict')
    expect(conflict.path).toBe('text.txt.mcp-kit.conflict')
    expect(conflict.content).toContain('<<<<<<< existing')

    await mkdir(resolve(cwd, 'src/mcp'), { recursive: true })
    await mkdir(resolve(cwd, '.mcp-kit'), { recursive: true })
    await writeFile(resolve(cwd, '.mcp-kit/manifest.json'), '{}')
    const manifestPlan = await internals.planAddCapability(cwd, {
      kind: 'tool',
      feature: 'manifest-branch',
      symbol: 'manifestBranch',
      ext: 'ts'
    })
    expect(
      manifestPlan.operations.find(
        (operation) => operation.path === '.mcp-kit/manifest.json'
      )?.kind
    ).toBe('overwrite')
    await rm(resolve(cwd, '.mcp-kit/manifest.json'))
    const createManifestPlan = await internals.planAddCapability(cwd, {
      kind: 'prompt',
      feature: 'manifest-create',
      symbol: 'manifestCreate',
      ext: 'ts'
    })
    expect(
      createManifestPlan.operations.find(
        (operation) => operation.path === '.mcp-kit/manifest.json'
      )?.kind
    ).toBe('create')
  })

  it('rolls back partially applied file plans', async () => {
    const cwd = await makeTemp()
    await writeFile(resolve(cwd, 'blocker'), 'not a directory')
    await writeFile(resolve(cwd, 'existing.txt'), 'before')

    await expect(
      internals.applyPlan(
        {
          root: cwd,
          operations: [
            { kind: 'create', path: 'noop.txt' },
            { kind: 'create', path: 'created.txt', content: 'created' },
            { kind: 'create', path: 'blocker/file.txt', content: 'fail' }
          ]
        },
        { allowOverwrite: false }
      )
    ).rejects.toThrow()
    await expect(
      readFile(resolve(cwd, 'created.txt'), 'utf8')
    ).rejects.toThrow()

    await expect(
      internals.applyPlan(
        {
          root: cwd,
          operations: [
            { kind: 'overwrite', path: 'existing.txt', content: 'after' },
            { kind: 'create', path: 'blocker/again.txt', content: 'fail' }
          ]
        },
        { allowOverwrite: true }
      )
    ).rejects.toThrow()
    await expect(readFile(resolve(cwd, 'existing.txt'), 'utf8')).resolves.toBe(
      'before'
    )
    await expect(
      internals.applyPlan(
        {
          root: cwd,
          operations: [
            { kind: 'create', path: 'existing.txt', content: 'before' }
          ]
        },
        { allowOverwrite: false }
      )
    ).resolves.toBeUndefined()
    await expect(
      internals.applyPlan(
        {
          root: cwd,
          operations: [
            { kind: 'create', path: 'existing.txt', content: 'different' }
          ]
        },
        { allowOverwrite: false }
      )
    ).rejects.toThrow('Refusing to overwrite unmanaged file')
  })

  it('detects git roots and package roots', async () => {
    const cwd = await makeTemp()
    const nested = resolve(cwd, 'a/b')
    await mkdir(resolve(cwd, '.git'), { recursive: true })
    await mkdir(nested, { recursive: true })

    await expect(internals.detectProjectRoot(nested, false)).resolves.toBe(cwd)
    await expect(internals.detectProjectRoot(nested, true)).resolves.toBe(
      nested
    )
    await rm(resolve(cwd, '.git'), { recursive: true, force: true })
    await writeFile(resolve(cwd, 'package.json'), '{}')
    await expect(internals.detectProjectRoot(nested, false)).resolves.toBe(cwd)
    await mkdir(resolve(cwd, '.git'), { recursive: true })
    await expect(internals.detectProjectContext(cwd)).resolves.toMatchObject({
      root: cwd,
      gitRoot: cwd
    })

    const standalone = await makeTemp()
    await expect(
      internals.detectProjectRoot(resolve(standalone, 'missing'), false)
    ).resolves.toBe(resolve(standalone, 'missing'))
  })

  it('renders package and main variants directly', () => {
    const template = JSON.stringify({
      scripts: { build: 'tsc', start: 'node dist/main.js', typecheck: 'tsc' },
      devDependencies: { typescript: '5' }
    })
    expect(
      internals.renderPackageJson(template, {
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
    expect(internals.renderMain('stdio')).toContain('await startStdio()')
    expect(internals.renderMain('http')).toContain('HTTP transport')
    expect(internals.renderMain('both')).toContain('MCP_TRANSPORT')
  })

  it('covers filesystem helper errors, manifests and remaining agent variants', async () => {
    const cwd = await makeTemp()
    await writeFile(resolve(cwd, 'file'), 'x')

    await expect(
      internals.safeReaddir(resolve(cwd, 'missing'))
    ).resolves.toEqual([])
    await expect(
      internals.safeReaddir(resolve(cwd, 'file/child'))
    ).rejects.toThrow()
    await expect(internals.exists(resolve(cwd, 'missing'))).resolves.toBe(false)
    await expect(internals.exists(resolve(cwd, 'file/child'))).rejects.toThrow()
    await expect(
      internals.readJsonFile(resolve(cwd, 'missing.json'))
    ).resolves.toBeUndefined()
    await writeFile(resolve(cwd, 'bad.json'), '{bad')
    await expect(
      internals.readJsonFile(resolve(cwd, 'bad.json'))
    ).resolves.toBeUndefined()

    expect(internals.isSupportedNodeVersion('22.13.0')).toBe(true)
    expect(internals.isSupportedNodeVersion('22.12.0')).toBe(false)
    expect(internals.isSupportedNodeVersion('24.0.0')).toBe(true)
    expect(internals.nodeVersionDiagnostic('22.12.0')).toMatchObject({
      level: 'error',
      code: 'node-version'
    })

    expect(
      internals.buildManifest(
        [
          { kind: 'create', path: 'a.txt', content: 'a' },
          { kind: 'create', path: 'skip.txt' }
        ],
        {
          transport: 'stdio',
          quality: 'standard',
          language: 'typescript',
          packageManager: 'pnpm',
          git: true,
          hooks: true,
          ci: true,
          install: true,
          agent: 'generic',
          force: false,
          dryRun: false
        }
      )
    ).toMatchObject({
      template: 'default',
      files: [{ path: 'a.txt' }]
    })
    expect(
      internals.mergeManifestFiles([
        { path: 'b.txt', checksum: 'old' },
        { path: 'a.txt', checksum: 'a' },
        { path: 'b.txt', checksum: 'new' },
        { ignored: true }
      ])
    ).toEqual([
      { path: 'a.txt', checksum: 'a' },
      { path: 'b.txt', checksum: 'new' }
    ])
    expect(internals.agentFiles('generic')).toEqual([
      {
        path: 'AGENTS.md',
        content: '# Agent Instructions\n\nUse mcp-kit conventions.\n'
      }
    ])
    expect(internals.agentFiles('codex')).toEqual([
      { path: 'AGENTS.md', content: '# Codex\n\nUse mcp-kit conventions.\n' }
    ])
    await expect(internals.findTemplateDirectory()).resolves.toContain(
      'templates/default'
    )
    await expect(
      internals.findTemplateDirectory([resolve(cwd, 'missing-template')])
    ).rejects.toThrow('Bundled project template was not found')
    await expect(internals.findTemplateDirectory(['\0'])).rejects.toThrow()
  })
})

async function makeTemp(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'mcp-kit-cli-'))
  temporaryDirectories.push(directory)
  return directory
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
