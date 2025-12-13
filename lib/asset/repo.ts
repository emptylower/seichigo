export type Asset = {
  id: string
  ownerId: string
  contentType: string
  filename: string | null
  bytes: Uint8Array
  createdAt: Date
}

export type CreateAssetInput = {
  ownerId: string
  contentType: string
  filename?: string | null
  bytes: Uint8Array
}

export interface AssetRepo {
  create(input: CreateAssetInput): Promise<Asset>
  findById(id: string): Promise<Asset | null>
}

