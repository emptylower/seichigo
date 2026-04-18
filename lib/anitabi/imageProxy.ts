type MapDisplayImageKind = 'cover' | 'point-thumbnail' | 'point-preview' | 'point' | 'default'

function isDirectSafeAnitabiHost(url: URL): boolean {
  const host = url.hostname.toLowerCase()
  return host === 'image.anitabi.cn' || host.endsWith('.anitabi.cn')
}

function canBypassProxy(url: URL): boolean {
  if (typeof window !== 'undefined' && url.origin === window.location.origin) {
    return true
  }
  return isDirectSafeAnitabiHost(url)
}

function buildProxyImageUrl(url: URL): string {
  const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://seichigo.com'
  const proxied = new URL('/api/anitabi/image-render', baseOrigin)
  proxied.searchParams.set('url', url.toString())
  return proxied.toString()
}

function buildRetryDirectUrl(url: URL): string {
  const retried = new URL(url.toString())
  retried.searchParams.set('_retry', '1')
  return retried.toString()
}

function dedupeCandidates(values: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = String(value || '').trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function isAnitabiPointPhotoPath(url: URL): boolean {
  return url.pathname.startsWith('/points/')
}

function normalizeBangumiCoverVariant(url: URL, kind: MapDisplayImageKind): void {
  if (kind !== 'cover') return
  const host = url.hostname.toLowerCase()
  const isBangumiHost = host === 'bgm.tv' || host.endsWith('.bgm.tv')
  if (!isBangumiHost) return

  url.pathname = url.pathname.replace('/pic/cover/l/', '/pic/cover/m/')
}

function normalizeAnitabiDisplayVariant(url: URL, kind: MapDisplayImageKind): void {
  const host = url.hostname.toLowerCase()
  const isAnitabiHost = host === 'anitabi.cn' || host === 'www.anitabi.cn' || host.endsWith('.anitabi.cn')
  if (!isAnitabiHost) return

  if (host === 'anitabi.cn' || host === 'www.anitabi.cn') {
    url.hostname = 'image.anitabi.cn'
  }
  if (url.pathname.startsWith('/images/')) {
    url.pathname = url.pathname.slice('/images'.length)
  }
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

function appendRetryNonce(url: URL, retryNonce: number | null | undefined): void {
  if (!retryNonce || retryNonce <= 0) return
  url.searchParams.set('_retry', String(retryNonce))
}

export function toCanvasSafeImageUrl(src: string, _hintName?: string): string {
  const raw = String(src || '').trim()
  if (!raw) return ''

  if (typeof window === 'undefined') return raw

  try {
    const url = new URL(raw, window.location.origin)
    if (canBypassProxy(url)) {
      return url.toString()
    }
    return buildProxyImageUrl(url)
  } catch {
    return raw
  }
}

export function getMapDisplayImageCandidates(
  src: string,
  options?: {
    kind?: MapDisplayImageKind
  }
): string[] {
  const raw = String(src || '').trim()
  if (!raw) return []

  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://seichigo.com'
    const url = new URL(raw, baseOrigin)
    const kind = options?.kind ?? 'default'
    normalizeBangumiCoverVariant(url, kind)
    normalizeAnitabiDisplayVariant(url, kind)

    const directUrl = url.toString()
    const proxyUrl = buildProxyImageUrl(url)
    if (url.origin === baseOrigin) {
      return [directUrl]
    }
    const shouldPreferDirect =
      isDirectSafeAnitabiHost(url)
      && (kind === 'cover' || kind === 'point' || kind === 'point-preview' || kind === 'point-thumbnail')

    return dedupeCandidates(
      shouldPreferDirect
        ? [directUrl, buildRetryDirectUrl(url), proxyUrl]
        : [proxyUrl]
    )
  } catch {
    return [raw]
  }
}

export function toMapDisplayImageUrl(
  src: string,
  options?: {
    kind?: MapDisplayImageKind
    retryNonce?: number | null
  }
): string {
  const primary = getMapDisplayImageCandidates(src, { kind: options?.kind })[0]
  if (!primary) return String(src || '').trim()

  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://seichigo.com'
    const finalUrl = new URL(primary, baseOrigin)
    appendRetryNonce(finalUrl, options?.retryNonce)
    return finalUrl.toString()
  } catch {
    return primary
  }
}
