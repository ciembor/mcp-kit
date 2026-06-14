const storeAdapterMetadataKey = Symbol.for('@mcp-kit/store-adapter-metadata')

export type StoreAdapterSupport = 'development-and-test' | 'production'

export type StoreAdapterMetadata = {
  readonly adapter: string
  readonly support: StoreAdapterSupport
}

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
  return isStoreAdapterMetadata(metadata) ? metadata : undefined
}

export function isDevelopmentOnlyStoreAdapter(store: unknown): boolean {
  return storeAdapterMetadata(store)?.support === 'development-and-test'
}

function isStoreAdapterMetadata(
  value: unknown
): value is StoreAdapterMetadata {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate['adapter'] === 'string' &&
    (candidate['support'] === 'development-and-test' ||
      candidate['support'] === 'production')
  )
}
