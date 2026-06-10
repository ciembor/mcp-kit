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
    items
      .map((item, index) => ({ item, index }))
      .sort((left, right) => {
        if (left.item.name < right.item.name) return -1
        return 1
      })
      .map(({ item }) => item)
  )
}
