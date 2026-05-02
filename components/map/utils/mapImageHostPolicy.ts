const DEGRADED_HOST_TTL_MS = 60_000
const DEGRADED_HOST_FAILURE_THRESHOLD = 2

export type MapImageHostPolicyScope = 'cover' | 'point' | 'point-thumbnail' | 'default'

type DegradedHostRecord = {
  degradedAt: number | null
  failures: number
}

const degradedDirectHosts = new Map<string, DegradedHostRecord>()

function toScopedHostKey(host: string | null, scope: MapImageHostPolicyScope): string | null {
  if (!host) return null
  return `${scope}:${host}`
}

export function isMapImageProxyUrl(url: string): boolean {
  return url.includes('/api/anitabi/image-render')
}

export function readMapImageHost(url: string): string | null {
  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://seichigo.com'
    return new URL(url, baseOrigin).hostname.trim().toLowerCase() || null
  } catch {
    return null
  }
}

export function markMapImageHostDegraded(
  host: string | null,
  scope: MapImageHostPolicyScope = 'default',
): void {
  const key = toScopedHostKey(host, scope)
  if (!key) return
  const current = degradedDirectHosts.get(key)
  const failures = (current?.failures ?? 0) + 1
  degradedDirectHosts.set(key, {
    failures,
    degradedAt: failures >= DEGRADED_HOST_FAILURE_THRESHOLD ? Date.now() : current?.degradedAt ?? null,
  })
}

export function clearMapImageHostDegraded(
  host: string | null,
  scope: MapImageHostPolicyScope = 'default',
): void {
  const key = toScopedHostKey(host, scope)
  if (!key) return
  degradedDirectHosts.delete(key)
}

export function isMapImageHostDegraded(
  host: string | null,
  scope: MapImageHostPolicyScope = 'default',
): boolean {
  const key = toScopedHostKey(host, scope)
  if (!key) return false
  const degradedAt = degradedDirectHosts.get(key)?.degradedAt ?? null
  if (degradedAt == null) return false
  if (Date.now() - degradedAt > DEGRADED_HOST_TTL_MS) {
    degradedDirectHosts.delete(key)
    return false
  }
  return true
}

export function prioritizeMapImageCandidates(
  urls: string[],
  scope: MapImageHostPolicyScope = 'default',
): string[] {
  if (scope === 'point' || scope === 'point-thumbnail') {
    return [...urls]
  }
  const firstDirectUrl = urls.find((url) => !isMapImageProxyUrl(url))
  const host = readMapImageHost(firstDirectUrl || '')
  if (!isMapImageHostDegraded(host, scope)) return [...urls]
  const proxyIdx = urls.findIndex((url) => isMapImageProxyUrl(url))
  if (proxyIdx <= 0) return [...urls]
  const ordered = [...urls]
  const [proxyUrl] = ordered.splice(proxyIdx, 1)
  ordered.unshift(proxyUrl)
  return ordered
}

export function resetDegradedMapImageHostsForTest(): void {
  degradedDirectHosts.clear()
}
