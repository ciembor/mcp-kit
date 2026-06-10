export function assertRegistryContracts(
  kind: string,
  definitions: readonly { name: string }[]
): void {
  const names = definitions.map(({ name }) => name)
  if (names.some((name) => name.length === 0)) {
    throw new Error(`${kind} name cannot be empty`)
  }
  if (new Set(names).size !== names.length) {
    throw new Error(`Duplicate ${kind} name`)
  }
  const sorted = [...names].sort((left, right) => (left < right ? -1 : 1))
  if (names.some((name, index) => name !== sorted[index])) {
    throw new Error(`${kind} registry is not sorted`)
  }
}
