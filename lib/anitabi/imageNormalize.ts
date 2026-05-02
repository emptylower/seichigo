export type MapDisplayImageKind = 'cover' | 'point-thumbnail' | 'point-preview' | 'point' | 'default'

const DEFAULT_BASE_ORIGIN = 'https://seichigo.com'
const MAP_IMAGE_DIAGNOSTIC_PARAM_PREFIX = '__mi_'
const STRIPPED_CANONICAL_QUERY_PARAMS = new Set(['_retry', 'name'])
const MIRROR_KEY_VERSION = 'mirror/v1'
const INVALID_IMAGE_URL_ERROR = 'invalid_image_url'

function getBaseOrigin(): string {
  return typeof window !== 'undefined' ? window.location.origin : DEFAULT_BASE_ORIGIN
}

function isAnitabiHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'anitabi.cn' || host === 'www.anitabi.cn' || host.endsWith('.anitabi.cn')
}

function isBangumiHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'bgm.tv' || host.endsWith('.bgm.tv')
}

function isAnitabiPointPhotoPath(url: URL): boolean {
  return url.pathname.startsWith('/points/')
}

function normalizeAnitabiMirrorUrl(url: URL): void {
  if (!isAnitabiHost(url.hostname)) return

  if (url.hostname === 'anitabi.cn' || url.hostname === 'www.anitabi.cn') {
    url.hostname = 'image.anitabi.cn'
  }
  if (url.pathname.startsWith('/images/')) {
    url.pathname = url.pathname.slice('/images'.length)
  }
}

function stripCanonicalQueryParams(url: URL): void {
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith(MAP_IMAGE_DIAGNOSTIC_PARAM_PREFIX) || STRIPPED_CANONICAL_QUERY_PARAMS.has(key)) {
      url.searchParams.delete(key)
    }
  }
}

function extensionFromMimeType(mimeType: string | null | undefined): string {
  const normalized = String(mimeType || '').toLowerCase()
  if (normalized.includes('image/jpeg') || normalized.includes('image/jpg')) return '.jpg'
  if (normalized.includes('image/png')) return '.png'
  if (normalized.includes('image/webp')) return '.webp'
  if (normalized.includes('image/avif')) return '.avif'
  if (normalized.includes('image/gif')) return '.gif'
  if (normalized.includes('image/svg+xml')) return '.svg'
  return '.jpg'
}

function bytesToHex(input: ArrayBuffer): string {
  return [...new Uint8Array(input)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

function parseAbsoluteHttpUrl(input: string): URL {
  const raw = String(input || '').trim()
  if (!raw) {
    throw new Error(INVALID_IMAGE_URL_ERROR)
  }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(INVALID_IMAGE_URL_ERROR)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(INVALID_IMAGE_URL_ERROR)
  }

  return url
}

export function stripMapImageDiagnosticParams(src: string | URL): URL {
  const url = src instanceof URL ? new URL(src.toString()) : new URL(src, getBaseOrigin())
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith(MAP_IMAGE_DIAGNOSTIC_PARAM_PREFIX)) {
      url.searchParams.delete(key)
    }
  }
  return url
}

export function normalizeBangumiCoverVariant(url: URL, kind: MapDisplayImageKind): void {
  if (kind !== 'cover' || !isBangumiHost(url.hostname)) return
  url.pathname = url.pathname.replace('/pic/cover/l/', '/pic/cover/m/')
}

export function normalizeAnitabiDisplayVariant(url: URL, kind: MapDisplayImageKind): void {
  if (!isAnitabiHost(url.hostname)) return

  normalizeAnitabiMirrorUrl(url)

  if (isAnitabiPointPhotoPath(url)) {
    if (kind === 'point' || kind === 'point-preview') {
      const hasWidthBasedResize =
        url.searchParams.has('w')
        || url.searchParams.has('h')
        || url.searchParams.has('q')
      const hasNamedPlan = Boolean(String(url.searchParams.get('plan') || '').trim())

      if (hasWidthBasedResize || !hasNamedPlan) {
        url.searchParams.delete('plan')
        if (!url.searchParams.has('w') && !url.searchParams.has('h')) {
          url.searchParams.set('w', '640')
        }
        if (!url.searchParams.has('q')) {
          url.searchParams.set('q', '80')
        }
      }
      return
    }

    if (kind === 'point-thumbnail') {
      const plan = url.searchParams.get('plan')
      if (!plan || !plan.trim()) {
        url.searchParams.set('plan', 'h160')
      }
      url.searchParams.delete('w')
      url.searchParams.delete('h')
      url.searchParams.delete('q')
      return
    }
  }

  if (kind === 'point' || kind === 'point-preview' || kind === 'point-thumbnail') {
    const desiredPlan = kind === 'point-thumbnail' ? 'h160' : 'h320'
    const plan = url.searchParams.get('plan')
    if (!plan || !plan.trim()) {
      url.searchParams.set('plan', desiredPlan)
    }
    url.searchParams.delete('w')
    url.searchParams.delete('h')
    url.searchParams.delete('q')
  }
}

export function computeCanonicalImageUrl(input: string): string {
  const url = parseAbsoluteHttpUrl(input)
  normalizeBangumiCoverVariant(url, 'cover')
  normalizeAnitabiMirrorUrl(url)
  stripCanonicalQueryParams(url)
  url.searchParams.sort()
  return url.toString()
}

export async function computeMirrorKey(canonicalUrl: string, mimeType: string): Promise<string> {
  const url = new URL(canonicalUrl)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalUrl))
  const hash = bytesToHex(digest).slice(0, 24)
  const ext = extensionFromMimeType(mimeType)
  return `${MIRROR_KEY_VERSION}/${url.hostname.toLowerCase()}/${hash}/${ext}`
}
