import { access, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type {
  RequestContext,
  ToolDefinition,
  ToolInputFieldPolicy
} from '../definitions.js'
import { McpKitError, type Schema } from '../definitions.js'

import { invalidInput, normalizeInputError } from './tool-io-errors.js'

export async function resolveToolPath<Services>(
  tool: ToolDefinition<Schema, Services>,
  context: RequestContext<Services>,
  candidate: string | URL
): Promise<string> {
  const roots = await toolFilesystemRoots(tool, context)
  return resolvePathAgainstRoots(
    { toolName: tool.name, roots, candidate },
    {
      noRootsSafeMessage: 'Filesystem access is not allowed for this tool.',
      outsideRootsSafeMessage:
        'Filesystem access is outside the configured roots.'
    }
  )
}

export async function toolFilesystemRoots<Services>(
  tool: ToolDefinition<Schema, Services>,
  context: RequestContext<Services>
): Promise<readonly URL[]> {
  const configured = tool.policy?.filesystem
  const roots = [...(configured?.roots ?? [])].map(asFileUrl)
  if (
    configured?.clientRoots !== true &&
    configured?.clientRoots !== 'require'
  ) {
    return roots
  }
  return appendClientRoots({
    toolName: tool.name,
    roots,
    requireClientRoots: configured.clientRoots === 'require',
    context,
    code: 'FORBIDDEN'
  })
}

export async function validateFilesystemPathField<Services>(args: {
  tool: ToolDefinition<Schema, Services>
  context: RequestContext<Services>
  path: string
  policy: Extract<ToolInputFieldPolicy, { kind: 'filesystemPath' }>
  value: unknown
}): Promise<void> {
  const { tool, context, path, policy, value } = args
  if (typeof value !== 'string') return
  assertFilesystemInputShape(tool.name, path, policy, value)
  if (!requiresRootValidation(policy) || isRelativeFilePath(value)) return

  try {
    const roots = await effectivePathRoots(tool, context, policy)
    await resolvePathAgainstRoots(
      { toolName: tool.name, roots, candidate: value },
      {
        noRootsSafeMessage: 'Filesystem path input has no configured roots.',
        outsideRootsSafeMessage: `Filesystem path input "${path}" is outside the configured roots.`
      }
    )
  } catch (error) {
    throw normalizeInputError(error, tool.name, path)
  }
}

type RootResolutionArgs = {
  toolName: string
  roots: readonly URL[]
  candidate: string | URL
}

async function resolvePathAgainstRoots(
  args: RootResolutionArgs,
  messages: {
    noRootsSafeMessage: string
    outsideRootsSafeMessage: string
  }
): Promise<string> {
  if (args.roots.length === 0) {
    throw new McpKitError({
      code: 'FORBIDDEN',
      message: `Tool ${args.toolName} attempted filesystem access without configured roots`,
      safeMessage: messages.noRootsSafeMessage
    })
  }

  const absoluteCandidate = normalizePathCandidate(args.candidate)
  const realAncestor = await realpath(
    await nearestExistingAncestor(absoluteCandidate)
  )
  for (const root of args.roots) {
    const realRoot = await resolvedRootPath(root)
    if (
      isWithin(realRoot, realAncestor) &&
      isWithin(normalizePathCandidate(root), absoluteCandidate)
    ) {
      return absoluteCandidate
    }
  }

  throw new McpKitError({
    code: 'FORBIDDEN',
    message: `Tool ${args.toolName} attempted filesystem access outside configured roots: ${absoluteCandidate}`,
    safeMessage: messages.outsideRootsSafeMessage
  })
}

function assertFilesystemInputShape(
  toolName: string,
  path: string,
  policy: Extract<ToolInputFieldPolicy, { kind: 'filesystemPath' }>,
  value: string
): void {
  if (policy.allowAbsolute !== true && isAbsolute(value)) {
    throw invalidInput(toolName, path, 'must be a relative path')
  }
  if (!hasParentTraversal(value)) return
  throw invalidInput(
    toolName,
    path,
    'must not contain parent traversal segments'
  )
}

function requiresRootValidation(
  policy: Extract<ToolInputFieldPolicy, { kind: 'filesystemPath' }>
): boolean {
  return (
    policy.roots !== undefined ||
    policy.clientRoots === true ||
    policy.clientRoots === 'require'
  )
}

function isRelativeFilePath(value: string): boolean {
  return !isAbsolute(value) && !value.startsWith('file://')
}

function asFileUrl(root: string | URL): URL {
  if (root instanceof URL) {
    if (root.protocol === 'file:') return new URL(root.toString())
    throw new Error(
      `Filesystem root must use file: protocol, received ${root.protocol}`
    )
  }
  return root.startsWith('file://')
    ? new URL(root)
    : pathToFileURL(resolvePath(root))
}

async function nearestExistingAncestor(targetPath: string): Promise<string> {
  let current = targetPath
  while (!(await exists(current)) && dirname(current) !== current) {
    current = dirname(current)
  }
  return current
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function isWithin(root: string, candidate: string): boolean {
  if (root === '/') return candidate.startsWith('/')
  return candidate === root || candidate.startsWith(`${root}/`)
}

async function effectivePathRoots<Services>(
  tool: ToolDefinition<Schema, Services>,
  context: RequestContext<Services>,
  policy: Extract<ToolInputFieldPolicy, { kind: 'filesystemPath' }>
): Promise<readonly URL[]> {
  const roots = [...(policy.roots ?? [])].map(asFileUrl)
  if (policy.clientRoots !== true && policy.clientRoots !== 'require')
    return roots
  return appendClientRoots({
    toolName: tool.name,
    roots,
    requireClientRoots: policy.clientRoots === 'require',
    context,
    code: 'INVALID_ARGUMENT'
  })
}

async function appendClientRoots<Services>(args: {
  toolName: string
  roots: readonly URL[]
  requireClientRoots: boolean
  context: RequestContext<Services>
  code: 'FORBIDDEN' | 'INVALID_ARGUMENT'
}): Promise<readonly URL[]> {
  if (!args.context.client.roots.supported) {
    if (!args.requireClientRoots) return args.roots
    throw clientRootsRequired(args.toolName, args.code)
  }

  const fileRoots = await listClientFileRoots(args.context)
  if (args.requireClientRoots && fileRoots.length === 0) {
    throw clientRootsRequired(args.toolName, args.code)
  }
  return [...args.roots, ...fileRoots]
}

function clientRootsRequired(
  toolName: string,
  code: 'FORBIDDEN' | 'INVALID_ARGUMENT'
): McpKitError {
  return new McpKitError({
    code,
    message: `Tool ${toolName} requires client filesystem roots`,
    safeMessage: 'Client filesystem roots are required.'
  })
}

async function listClientFileRoots<Services>(
  context: RequestContext<Services>
): Promise<readonly URL[]> {
  return (
    (await context.client.roots.list())
      ?.map((root) => {
        try {
          return new URL(root.uri)
        } catch {
          return undefined
        }
      })
      .filter((root): root is URL => root?.protocol === 'file:') ?? []
  )
}

function normalizePathCandidate(candidate: string | URL): string {
  if (candidate instanceof URL) {
    if (candidate.protocol !== 'file:') {
      throw new McpKitError({
        code: 'FORBIDDEN',
        message: `Unsupported filesystem URL protocol: ${candidate.protocol}`,
        safeMessage: 'Filesystem access requires file paths or file URLs.'
      })
    }
    return resolvePath(fileURLToPath(candidate))
  }
  return candidate.startsWith('file://')
    ? resolvePath(fileURLToPath(new URL(candidate)))
    : resolvePath(candidate)
}

function hasParentTraversal(path: string): boolean {
  return path
    .replaceAll('\\', '/')
    .split('/')
    .some((segment) => segment === '..')
}

async function resolvedRootPath(root: URL): Promise<string> {
  const rootPath = normalizePathCandidate(root)
  return realpath(rootPath).catch(() => rootPath)
}
