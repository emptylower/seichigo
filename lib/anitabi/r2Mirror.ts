import { computeCanonicalImageUrl, computeMirrorKey } from '@/lib/anitabi/imageNormalize'

const FRESH_MIRROR_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export type MirrorSource = 'lazy' | 'cron-seed' | 'cron-delta' | 'cron-refresh'

type R2ObjectMetadata = {
  customMetadata?: Record<string, string>
  httpMetadata?: { contentType?: string }
  size?: number
}

type R2ObjectBody = R2ObjectMetadata & {
  arrayBuffer(): Promise<ArrayBuffer>
}

export type R2MirrorBucket = {
  head(key: string): Promise<R2ObjectMetadata | null>
  get(key: string): Promise<R2ObjectBody | null>
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView,
    options?: {
      customMetadata?: Record<string, string>
      httpMetadata?: { contentType?: string }
    },
  ): Promise<unknown>
}

export type PutResult = {
  key: string
  bytesWritten: number
  skipped: boolean
}

function isFreshMirror(mirroredAt: string | undefined): boolean {
  if (!mirroredAt) return false

  const mirroredAtMs = Date.parse(mirroredAt)
  if (Number.isNaN(mirroredAtMs)) return false

  return Date.now() - mirroredAtMs < FRESH_MIRROR_MAX_AGE_MS
}

async function resolveMirrorKey(rawUrl: string, mimeType: string): Promise<{ canonicalUrl: string; key: string }> {
  const canonicalUrl = computeCanonicalImageUrl(rawUrl)
  const key = await computeMirrorKey(canonicalUrl, mimeType)
  return { canonicalUrl, key }
}

export async function putMirroredImage(
  bucket: R2MirrorBucket,
  rawUrl: string,
  bytes: ArrayBuffer,
  mimeType: string,
  mirrorSource: MirrorSource,
): Promise<PutResult> {
  const { canonicalUrl, key } = await resolveMirrorKey(rawUrl, mimeType)
  const existing = await bucket.head(key)

  if (isFreshMirror(existing?.customMetadata?.mirroredAt)) {
    return {
      key,
      bytesWritten: existing?.size ?? bytes.byteLength,
      skipped: true,
    }
  }

  await bucket.put(key, bytes, {
    httpMetadata: { contentType: mimeType },
    customMetadata: {
      originalUrl: canonicalUrl,
      mimeType,
      mirroredAt: new Date().toISOString(),
      mirrorSource,
      contentLength: String(bytes.byteLength),
    },
  })

  return {
    key,
    bytesWritten: bytes.byteLength,
    skipped: false,
  }
}

export async function getMirroredImage(
  bucket: R2MirrorBucket,
  rawUrl: string,
  mimeType: string,
): Promise<{
  key: string
  bytes: ArrayBuffer
  customMetadata: Record<string, string>
  httpContentType?: string
  size?: number
} | null> {
  const { key } = await resolveMirrorKey(rawUrl, mimeType)

  try {
    const object = await bucket.get(key)
    if (!object) return null

    return {
      key,
      bytes: await object.arrayBuffer(),
      customMetadata: object.customMetadata || {},
      httpContentType: object.httpMetadata?.contentType,
      size: object.size,
    }
  } catch {
    return null
  }
}
