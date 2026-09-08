import type { CfBindings } from '@/lib/anitabi/cf/bindings'

/**
 * 2026-09-08 图片资产迁 R2：上传与存量迁移共用的归一化逻辑。
 * 非 GIF/AVIF 的图片经 Images 绑定缩到最大宽 1600、转 WebP（质量 82）；
 * GIF/AVIF 原样存储（GIF 有动画、AVIF 已足够高效，重编码得不偿失）。
 */

export const NORMALIZE_MAX_WIDTH = 1600
export const NORMALIZE_QUALITY = 82

type ImagesBindingLike = NonNullable<NonNullable<CfBindings['env']>['IMAGES']>

export function isSvgContentType(contentType: string | null | undefined): boolean {
  return String(contentType || '').trim().toLowerCase() === 'image/svg+xml'
}

export function isGifContentType(contentType: string | null | undefined): boolean {
  return String(contentType || '').trim().toLowerCase() === 'image/gif'
}

export function isAvifContentType(contentType: string | null | undefined): boolean {
  return String(contentType || '').trim().toLowerCase() === 'image/avif'
}

/** GIF/AVIF（以及不可转换的 SVG）原样存，其余图片走 Images 归一化 */
export function shouldNormalizeForStorage(contentType: string | null | undefined): boolean {
  if (isGifContentType(contentType)) return false
  if (isAvifContentType(contentType)) return false
  if (isSvgContentType(contentType)) return false
  return String(contentType || '').startsWith('image/')
}

function readDimensionHeader(headers: Headers, names: string[]): number | null {
  for (const name of names) {
    const raw = headers.get(name)
    if (!raw) continue
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return null
}

/** 单块 ReadableStream：喂 Images 绑定时避免 Blob/Buffer.from 的额外整份拷贝 */
export function uint8ArrayToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

export type NormalizedImage = {
  bytes: Uint8Array
  contentType: 'image/webp'
  width: number | null
  height: number | null
}

/**
 * 经 Images 绑定归一化。返回 null 表示转换失败（调用方回落原始字节，
 * 保证迁移/上传不因 Images 抖动而中断）。
 */
export async function normalizeImageForStorage(
  images: ImagesBindingLike,
  bytes: Uint8Array,
): Promise<NormalizedImage | null> {
  try {
    const result = await images
      .input(uint8ArrayToStream(bytes))
      .transform({ width: NORMALIZE_MAX_WIDTH, fit: 'scale-down' })
      .output({ format: 'image/webp', quality: NORMALIZE_QUALITY })
    const response = result.response()
    const normalized = new Uint8Array(await response.arrayBuffer())
    if (normalized.byteLength === 0) return null
    return {
      bytes: normalized,
      contentType: 'image/webp',
      width: readDimensionHeader(response.headers, ['cf-images-width', 'x-width']),
      height: readDimensionHeader(response.headers, ['cf-images-height', 'x-height']),
    }
  } catch (error) {
    console.error('[asset.normalize.failed]', {
      event: 'asset_image_normalize_failed',
      error: error instanceof Error
        ? { name: error.name, message: error.message }
        : { message: String(error) },
    })
    return null
  }
}
