import { prisma } from '@/lib/db/prisma'
import type { Asset, AssetRepo, CreateAssetInput } from './repo'

declare global {
  // eslint-disable-next-line no-var
  var assetReadCache: { items: Map<string, Asset>; totalBytes: number } | undefined
}

const MAX_ASSET_CACHE_ITEMS = 24
const MAX_ASSET_CACHE_BYTES = 12 * 1024 * 1024

function getAssetReadCache() {
  if (!global.assetReadCache) {
    global.assetReadCache = {
      items: new Map<string, Asset>(),
      totalBytes: 0,
    }
  }

  return global.assetReadCache
}

function estimateAssetBytes(asset: Asset): number {
  return asset.bytes.byteLength
}

function cacheAsset(asset: Asset) {
  const cache = getAssetReadCache()
  const existing = cache.items.get(asset.id)

  if (existing) {
    cache.totalBytes -= estimateAssetBytes(existing)
    cache.items.delete(asset.id)
  }

  cache.items.set(asset.id, asset)
  cache.totalBytes += estimateAssetBytes(asset)

  while (cache.items.size > MAX_ASSET_CACHE_ITEMS || cache.totalBytes > MAX_ASSET_CACHE_BYTES) {
    const oldestKey = cache.items.keys().next().value
    if (!oldestKey) break
    const oldest = cache.items.get(oldestKey)
    cache.items.delete(oldestKey)
    if (oldest) {
      cache.totalBytes -= estimateAssetBytes(oldest)
    }
  }
}

function getCachedAsset(id: string): Asset | null {
  const cache = getAssetReadCache()
  const cached = cache.items.get(id)
  if (!cached) return null

  cache.items.delete(id)
  cache.items.set(id, cached)
  return cached
}

export class PrismaAssetRepo implements AssetRepo {
  async create(input: CreateAssetInput): Promise<Asset> {
    const created = await prisma.asset.create({
      data: {
        ownerId: input.ownerId,
        contentType: input.contentType,
        filename: input.filename ?? undefined,
        bytes: Buffer.from(input.bytes),
      },
    })

    cacheAsset(created)
    return created
  }

  async findById(id: string): Promise<Asset | null> {
    const cached = getCachedAsset(id)
    if (cached) return cached

    const found = await prisma.asset.findUnique({ where: { id } })
    if (found) cacheAsset(found)
    return found
  }
}
