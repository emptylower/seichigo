export type Asset = {
  id: string
  ownerId: string
  contentType: string
  filename: string | null
  /**
   * 2026-09-08 图片资产迁 R2：R2 原图 key（originals/<id>）。
   * null 表示尚未迁移，读路径回落 bytes 列。
   * 注意：findById 不再返回 bytes（防内存超限），需要原始字节用 findBytesById。
   */
  storageKey: string | null
  byteLength: number | null
  width: number | null
  height: number | null
  createdAt: Date
}

export type CreateAssetInput = {
  id?: string
  ownerId: string
  contentType: string
  filename?: string | null
  bytes: Uint8Array
  storageKey?: string | null
  byteLength?: number | null
  width?: number | null
  height?: number | null
}

export type AssetR2Fields = {
  storageKey: string
  byteLength: number | null
  width: number | null
  height: number | null
}

export interface AssetRepo {
  create(input: CreateAssetInput): Promise<Asset>
  findById(id: string): Promise<Asset | null>
  /** 只在回落路径读 bytes（pg bytea 十六进制解码会放大内存占用，能不用就不用） */
  findBytesById(id: string): Promise<Uint8Array | null>
  listUnmigratedIds(limit: number): Promise<string[]>
  countAll(): Promise<number>
  countUnmigrated(): Promise<number>
  updateR2Fields(id: string, fields: AssetR2Fields): Promise<void>
}
