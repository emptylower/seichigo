import { computeCanonicalImageUrl, computeMirrorKey } from '@/lib/anitabi/imageNormalize'

const FRESH_MIRROR_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const PROBE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/svg+xml',
] as const

export type MirrorSource = 'lazy' | 'cron-seed' | 'cron-delta' | 'cron-refresh'
export type R2MirrorCustomMetadata = {
  originalUrl: string
  mimeType: string
  mirroredAt: string
  mirrorSource: string
  contentLength: string
} & Record<string, string>

type R2ObjectMetadata = {
  customMetadata?: R2MirrorCustomMetadata
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
      customMetadata?: R2MirrorCustomMetadata
      httpMetadata?: { contentType?: string }
    },
  ): Promise<unknown>
}

export type PutResult = {
  key: string
  bytesWritten: number
  skipped: boolean
  existingSize?: number
  aborted?: boolean
}

export type PutMirroredImageOptions = {
  beforePut?: (candidate: { canonicalUrl: string; key: string; mimeType: string }) => boolean | Promise<boolean>
}

function isFreshMirror(mirroredAt: string | undefined): boolean {
  if (!mirroredAt) return false

  const mirroredAtMs = Date.parse(mirroredAt)
  if (Number.isNaN(mirroredAtMs)) return false

  const ageMs = Date.now() - mirroredAtMs
  return ageMs >= 0 && ageMs < FRESH_MIRROR_MAX_AGE_MS
}

async function resolveMirrorKey(rawUrl: string, mimeType: string): Promise<{ canonicalUrl: string; key: string }> {
  const canonicalUrl = computeCanonicalImageUrl(rawUrl)
  const key = await computeMirrorKey(canonicalUrl, mimeType)
  return { canonicalUrl, key }
}

async function resolveMirrorKeys(
  rawUrl: string,
  mimeType?: string,
): Promise<Array<{ canonicalUrl: string; key: string; mimeType: string }>> {
  const canonicalUrl = computeCanonicalImageUrl(rawUrl)
  const mimeTypes = mimeType ? [mimeType] : PROBE_MIME_TYPES

  return Promise.all(mimeTypes.map(async (candidateMimeType) => ({
    canonicalUrl,
    key: await computeMirrorKey(canonicalUrl, candidateMimeType),
    mimeType: candidateMimeType,
  })))
}

export async function putMirroredImage(
  bucket: R2MirrorBucket,
  rawUrl: string,
  bytes: ArrayBuffer,
  mimeType: string,
  mirrorSource: MirrorSource,
  opts?: PutMirroredImageOptions,
): Promise<PutResult> {
  const { canonicalUrl, key } = await resolveMirrorKey(rawUrl, mimeType)
  const existing = await bucket.head(key)

  if (isFreshMirror(existing?.customMetadata?.mirroredAt)) {
    return {
      key,
      bytesWritten: 0,
      skipped: true,
      existingSize: existing?.size,
    }
  }

  if (opts?.beforePut) {
    const shouldPut = await opts.beforePut({ canonicalUrl, key, mimeType })
    if (!shouldPut) {
      return {
        key,
        bytesWritten: 0,
        skipped: false,
        aborted: true,
      }
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
  mimeType?: string,
): Promise<{
  key: string
  bytes: ArrayBuffer
  customMetadata: R2MirrorCustomMetadata
  httpContentType?: string
  size?: number
} | null> {
  const candidates = await resolveMirrorKeys(rawUrl, mimeType)

  for (const candidate of candidates) {
    try {
      const object = await bucket.get(candidate.key)
      if (!object) continue

      return {
        key: candidate.key,
        bytes: await object.arrayBuffer(),
        customMetadata: object.customMetadata || {
          originalUrl: candidate.canonicalUrl,
          mimeType: candidate.mimeType,
          mirroredAt: '',
          mirrorSource: '',
          contentLength: object.size ? String(object.size) : '',
        },
        httpContentType: object.httpMetadata?.contentType,
        size: object.size,
      }
    } catch {
      continue
    }
  }

  return null
}
