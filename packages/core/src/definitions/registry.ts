import type { RegistryItem } from './contracts.js'

export function defineRegistry<const Item extends RegistryItem>(
  items: readonly Item[]
): readonly Item[] {
  const names = new Set<string>()
  for (const item of items) {
    if (names.has(item.name)) {
      throw new Error(`Duplicate registry entry: ${item.name}`)
    }
    names.add(item.name)
  }

  return Object.freeze(
    [...items].sort((left, right) => {
      if (left.name < right.name) return -1
      if (left.name > right.name) return 1
      return 0
    })
  )
}
