import crypto from 'node:crypto'
import type { Asset, AssetRepo, CreateAssetInput } from './repo'

type Options = {
  now?: () => Date
  idFactory?: () => string
}

export class InMemoryAssetRepo implements AssetRepo {
  private readonly now: () => Date
  private readonly idFactory: () => string
  private readonly byId = new Map<string, Asset>()

  constructor(options?: Options) {
    this.now = options?.now ?? (() => new Date())
    this.idFactory = options?.idFactory ?? (() => crypto.randomUUID())
  }

  async create(input: CreateAssetInput): Promise<Asset> {
    const asset: Asset = {
      id: this.idFactory(),
      ownerId: input.ownerId,
      contentType: input.contentType,
      filename: input.filename ?? null,
      bytes: input.bytes,
      createdAt: this.now(),
    }
    this.byId.set(asset.id, asset)
    return asset
  }

  async findById(id: string): Promise<Asset | null> {
    return this.byId.get(id) ?? null
  }
}

