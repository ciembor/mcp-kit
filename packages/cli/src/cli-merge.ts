import type { JsonObject } from './cli-contracts.js'
import { asJsonObject, isJsonObject } from './cli-utils.js'

export function packageJsonMergeContent(
  existing: string,
  next: string
): string {
  return `${JSON.stringify(
    mergePackageJson(
      JSON.parse(existing) as JsonObject,
      JSON.parse(next) as JsonObject
    ),
    null,
    2
  )}\n`
}

export function jsonMergeContent(existing: string, next: string): string {
  return `${JSON.stringify(
    deepMerge(
      JSON.parse(existing) as JsonObject,
      JSON.parse(next) as JsonObject
    ),
    null,
    2
  )}\n`
}

export function conflictContent(existing: string, next: string): string {
  return `<<<<<<< existing\n${existing.trimEnd()}\n=======\n${next.trimEnd()}\n>>>>>>> mcp-kit\n`
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
