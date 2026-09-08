import crypto from 'node:crypto'
import type { Asset, AssetR2Fields, AssetRepo, CreateAssetInput } from './repo'

type Options = {
  now?: () => Date
  idFactory?: () => string
}

type StoredAsset = {
  meta: Asset
  bytes: Uint8Array
}

export class InMemoryAssetRepo implements AssetRepo {
  private readonly now: () => Date
  private readonly idFactory: () => string
  private readonly byId = new Map<string, StoredAsset>()

  constructor(options?: Options) {
    this.now = options?.now ?? (() => new Date())
    this.idFactory = options?.idFactory ?? (() => crypto.randomUUID())
  }

  async create(input: CreateAssetInput): Promise<Asset> {
    const meta: Asset = {
      id: input.id ?? this.idFactory(),
      ownerId: input.ownerId,
      contentType: input.contentType,
      filename: input.filename ?? null,
      storageKey: input.storageKey ?? null,
      byteLength: input.byteLength ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      createdAt: this.now(),
    }
    this.byId.set(meta.id, { meta, bytes: input.bytes })
    return { ...meta }
  }

  async findById(id: string): Promise<Asset | null> {
    const stored = this.byId.get(id)
    return stored ? { ...stored.meta } : null
  }

  async findBytesById(id: string): Promise<Uint8Array | null> {
    const stored = this.byId.get(id)
    return stored ? stored.bytes : null
  }

  async listUnmigratedIds(limit: number): Promise<string[]> {
    return [...this.byId.values()]
      .filter((stored) => stored.meta.storageKey === null)
      .sort((a, b) => a.meta.createdAt.getTime() - b.meta.createdAt.getTime())
      .slice(0, limit)
      .map((stored) => stored.meta.id)
  }

  async countAll(): Promise<number> {
    return this.byId.size
  }

  async countUnmigrated(): Promise<number> {
    let count = 0
    for (const stored of this.byId.values()) {
      if (stored.meta.storageKey === null) count++
    }
    return count
  }

  async updateR2Fields(id: string, fields: AssetR2Fields): Promise<void> {
    const stored = this.byId.get(id)
    if (!stored) throw new Error(`Asset not found: ${id}`)
    stored.meta = {
      ...stored.meta,
      storageKey: fields.storageKey,
      byteLength: fields.byteLength,
      width: fields.width,
      height: fields.height,
    }
  }
}
