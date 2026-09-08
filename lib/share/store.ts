import { getCfBindings } from '@/lib/anitabi/cf/bindings'

/**
 * 分享资产复用 asset 的 R2 桶（绑定名 ASSET_STORE，桶 seichigo-assets）。
 * - 卡片 key：`share/<code>-<fingerprint>.<jpg|webp>`（fingerprint = 卡片字节 sha256 前 8 位，
 *   内容一变 key 就变，客户端靠 `?v=<fingerprint>` 绕开 immutable 缓存）
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
  /** 只取元数据的存在性探测（R2 原生 head）：不产生 body 流，handler 探测 photo 用这个 */
  head(key: string): Promise<{ size: number; contentType: string } | null>
  /** 换卡片后清旧对象；失败只记日志，不阻断上传 */
  delete(key: string): Promise<void>
}

export function shareCardKey(code: string, fingerprint: string, contentType: string): string {
  const ext = String(contentType || '').toLowerCase() === 'image/webp' ? 'webp' : 'jpg'
  return `share/${code}-${fingerprint}.${ext}`
}

/** 从 `share/<code>-<fp>.<ext>` 解析 8 位指纹；旧格式（无指纹段）返回 null */
export function shareCardFingerprint(imageKey: string): string | null {
  const match = /^share\/[A-Za-z0-9]+-([0-9a-f]{8})\.(?:jpg|webp)$/.exec(imageKey)
  return match?.[1] ?? null
}

export function checkinPhotoKey(userId: string, pointId: string): string {
  return `checkin/${userId}/${pointId}.jpg`
}

type ShareBucket = NonNullable<
  NonNullable<import('@/lib/anitabi/cf/bindings').CfBindings['env']>['ASSET_STORE']
>

/**
 * R2Bucket 还有 delete 与 head，但 bindings.ts 的手写结构子集没覆盖到；
 * 运行时真桶有这些方法，这里只在 share 域内补齐形状（bindings 不归 Track A 管）。
 */
type DeletableShareBucket = ShareBucket & {
  delete(key: string): Promise<void>
  head(key: string): Promise<{ size: number; httpMetadata?: { contentType?: string } } | null>
}

class R2ShareStore implements ShareStore {
  constructor(private readonly bucket: DeletableShareBucket) {}

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

  async head(key: string): Promise<{ size: number; contentType: string } | null> {
    const object = await this.bucket.head(key)
    if (!object) return null
    return {
      size: object.size,
      contentType: String(object.httpMetadata?.contentType || 'application/octet-stream'),
    }
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key)
  }
}

export function getShareStore(): ShareStore | null {
  const bucket = getCfBindings()?.env?.ASSET_STORE
  if (!bucket) return null
  return new R2ShareStore(bucket as DeletableShareBucket)
}
