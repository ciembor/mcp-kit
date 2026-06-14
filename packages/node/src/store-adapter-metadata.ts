type StoreAdapterSupport = 'development-and-test' | 'production'

type StoreAdapterMetadata = {
  readonly adapter: string
  readonly support: StoreAdapterSupport
}

const storeAdapterMetadataKey = Symbol.for('@mcp-kit/store-adapter-metadata')

export function defineStoreAdapterMetadata<Store extends object>(
  store: Store,
  metadata: StoreAdapterMetadata
): Store {
  Object.defineProperty(store, storeAdapterMetadataKey, {
    value: metadata,
    configurable: false,
    enumerable: false,
    writable: false
  })
  return store
}

export function storeAdapterMetadata(
  store: unknown
): StoreAdapterMetadata | undefined {
  if (typeof store !== 'object' || store === null) {
    return undefined
  }
  const metadata = (store as Record<PropertyKey, unknown>)[
    storeAdapterMetadataKey
  ]
  if (typeof metadata !== 'object' || metadata === null) {
    return undefined
  }
  const candidate = metadata as Record<string, unknown>
  if (typeof candidate['adapter'] !== 'string') {
    return undefined
  }
  if (
    candidate['support'] !== 'development-and-test' &&
    candidate['support'] !== 'production'
  ) {
    return undefined
  }
  return candidate as StoreAdapterMetadata
}
