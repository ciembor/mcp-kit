export function unknownInputPaths(
  input: unknown,
  parsed: unknown,
  path: readonly string[] = []
): readonly string[] {
  if (!isPlainObject(input) || !isPlainObject(parsed)) {
    return []
  }

  const unknown: string[] = []
  for (const [key, value] of Object.entries(input)) {
    if (!(key in parsed)) {
      unknown.push([...path, key].join('.'))
      continue
    }

    unknown.push(...unknownInputPaths(value, parsed[key], [...path, key]))
  }

  return unknown
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
