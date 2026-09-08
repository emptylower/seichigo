import { getCfBindings } from '@/lib/anitabi/cf/bindings'

/**
 * 2026-09-08 图片资产迁 R2：原图与变体的 R2 访问层。
 * - 原图 key：`originals/<assetId>`
 * - 变体 key：`variants/<assetId>/w<width>-q<quality>.webp`
 * 读路径全程流式：getOriginal/getVariant 返回 R2 对象流，不在内存里拼整张图。
 * 拿不到 ASSET_STORE 绑定（next dev / vitest）时 getAssetStore() 返回 null，
 * 调用方回落 Postgres bytes 列（含 sharp 回落）。
 */

export type AssetBucket = NonNullable<import('@/lib/anitabi/cf/bindings').CfBindingsEnv['ASSET_STORE']>

export type StoredOriginal = {
  body: ReadableStream<Uint8Array>
  contentType: string
  size: number
}

export type StoredVariant = {
  body: ReadableStream<Uint8Array>
  size: number
}

export interface AssetStore {
  putOriginal(
    storageKey: string,
    body: ReadableStream<Uint8Array> | Uint8Array,
    contentType: string,
  ): Promise<void>
  getOriginal(storageKey: string): Promise<StoredOriginal | null>
  getVariant(id: string, width: number, quality: number): Promise<StoredVariant | null>
  putVariant(id: string, width: number, quality: number, bytes: Uint8Array): Promise<void>
}

export function originalKey(id: string): string {
  return `originals/${id}`
}

export function variantKey(id: string, width: number, quality: number): string {
  return `variants/${id}/w${width}-q${quality}.webp`
}

class R2AssetStore implements AssetStore {
  constructor(private readonly bucket: AssetBucket) {}

  async putOriginal(
    storageKey: string,
    body: ReadableStream<Uint8Array> | Uint8Array,
    contentType: string,
  ): Promise<void> {
    await this.bucket.put(storageKey, body, {
      httpMetadata: { contentType },
    })
  }

  async getOriginal(storageKey: string): Promise<StoredOriginal | null> {
    const object = await this.bucket.get(storageKey)
    if (!object) return null
    return {
      body: object.body,
      contentType: String(object.httpMetadata?.contentType || 'application/octet-stream'),
      size: object.size,
    }
  }

  async getVariant(id: string, width: number, quality: number): Promise<StoredVariant | null> {
    const object = await this.bucket.get(variantKey(id, width, quality))
    if (!object) return null
    return { body: object.body, size: object.size }
  }

  async putVariant(id: string, width: number, quality: number, bytes: Uint8Array): Promise<void> {
    await this.bucket.put(variantKey(id, width, quality), bytes, {
      httpMetadata: { contentType: 'image/webp' },
    })
  }
}

export function getAssetStore(): AssetStore | null {
  const bucket = getCfBindings()?.env?.ASSET_STORE
  if (!bucket) return null
  return new R2AssetStore(bucket)
}
