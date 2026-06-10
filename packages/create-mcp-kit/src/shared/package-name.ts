export function toPackageName(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
  const packageName = trimEdgeHyphens(normalized)

  if (packageName === '') {
    throw new Error(`Cannot derive a package name from "${value}"`)
  }
  return packageName
}

function trimEdgeHyphens(value: string): string {
  let start = 0
  let end = value.length
  while (value[start] === '-') start += 1
  while (value[end - 1] === '-') end -= 1
  return value.slice(start, end)
}
