export function toCanvasSafeImageUrl(src: string, hintName?: string): string {
  const raw = String(src || '').trim()
  if (!raw) return ''

  if (typeof window === 'undefined') return raw

  try {
    const url = new URL(raw, window.location.origin)
    if (url.origin === window.location.origin) {
      return url.toString()
    }

    const proxied = new URL('/api/anitabi/image-download', window.location.origin)
    proxied.searchParams.set('url', url.toString())
    if (hintName) {
      proxied.searchParams.set('name', hintName)
    }
    return proxied.toString()
  } catch {
    return raw
  }
}
