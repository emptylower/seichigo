import { getCfBindings } from '@/lib/anitabi/cf/bindings'

/**
 * 分享资产复用 asset 的 R2 桶（绑定名 ASSET_STORE，桶 seichigo-assets）。
 * - 卡片 key：`share/<code>.<jpg|webp>`
 * - 实拍 key：`checkin/<userId>/<pointId>.jpg`
 * 拿不到绑定（next dev / vitest）返回 null，调用方转 503。
 */
export type ShareObject = {
  body: ReadableStream<Uint8Array>
  contentType: string
  size: number
}

export interface ShareStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>
  get(key: string): Promise<ShareObject | null>
}

export function shareCardKey(code: string, contentType: string): string {
  const ext = String(contentType || '').toLowerCase() === 'image/webp' ? 'webp' : 'jpg'
  return `share/${code}.${ext}`
}

export function checkinPhotoKey(userId: string, pointId: string): string {
  return `checkin/${userId}/${pointId}.jpg`
}

type ShareBucket = NonNullable<
  NonNullable<import('@/lib/anitabi/cf/bindings').CfBindings['env']>['ASSET_STORE']
>

class R2ShareStore implements ShareStore {
  constructor(private readonly bucket: ShareBucket) {}

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.bucket.put(key, bytes, { httpMetadata: { contentType } })
  }

  async get(key: string): Promise<ShareObject | null> {
    const object = await this.bucket.get(key)
    if (!object) return null
    return {
      body: object.body,
      contentType: String(object.httpMetadata?.contentType || 'application/octet-stream'),
      size: object.size,
    }
  }
}

export function getShareStore(): ShareStore | null {
  const bucket = getCfBindings()?.env?.ASSET_STORE
  if (!bucket) return null
  return new R2ShareStore(bucket)
}
