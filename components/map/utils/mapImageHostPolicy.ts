const DEGRADED_HOST_TTL_MS = 60_000
const DEGRADED_HOST_FAILURE_THRESHOLD = 2
const BLOCKED_HOST_FAILURE_THRESHOLD = 3
const BLOCKED_HOST_FAILURE_WINDOW_MS = 10_000
const DEGRADED_HOST_TIMEOUT_MS = 2_000
export type MapImageHostPolicyScope = 'cover' | 'point' | 'point-thumbnail' | 'default'
export type MapImageHostState = 'healthy' | 'degraded' | 'blocked'

type DegradedHostRecord = {
  degradedAt: number | null
  blockedAt: number | null
  failures: number
  recentFailures: number[]
}

const degradedDirectHosts = new Map<string, DegradedHostRecord>()

function toScopedHostKey(host: string | null, scope: MapImageHostPolicyScope): string | null {
  if (!host) return null
  return `${scope}:${host}`
}

function isMapImageBreakerV2Enabled(): boolean {
  return process.env.NEXT_PUBLIC_MAP_IMAGE_BREAKER_V2_ENABLED === '1'
}

function trimRecentFailures(failures: number[], now: number): number[] {
  return failures.filter((failureAt) => now - failureAt <= BLOCKED_HOST_FAILURE_WINDOW_MS)
}

function hasExpired(at: number | null, now: number): boolean {
  return at != null && now - at > DEGRADED_HOST_TTL_MS
}

function readActiveHostRecord(key: string, now: number): DegradedHostRecord | null {
  const current = degradedDirectHosts.get(key)
  if (!current) return null

  const degradedExpired = hasExpired(current.degradedAt, now)
  const degradedAt = degradedExpired ? null : current.degradedAt
  const blockedAt = hasExpired(current.blockedAt, now) ? null : current.blockedAt
  const recentFailures = trimRecentFailures(current.recentFailures, now)
  const failures = degradedExpired ? 0 : current.failures

  if (degradedAt == null && blockedAt == null && recentFailures.length === 0 && failures === 0) {
    degradedDirectHosts.delete(key)
    return null
  }

  const nextRecord: DegradedHostRecord = {
    degradedAt,
    blockedAt,
    failures,
    recentFailures,
  }
  degradedDirectHosts.set(key, nextRecord)
  return nextRecord
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
  recordHostFailure(host, scope, Date.now())
}

export function recordHostFailure(
  host: string | null,
  scope: MapImageHostPolicyScope = 'default',
  now: number,
): void {
  const key = toScopedHostKey(host, scope)
  if (!key) return
  const current = readActiveHostRecord(key, now)
  const failures = (current?.failures ?? 0) + 1
  const recentFailures = trimRecentFailures([...(current?.recentFailures ?? []), now], now)
  degradedDirectHosts.set(key, {
    failures,
    degradedAt: failures >= DEGRADED_HOST_FAILURE_THRESHOLD ? current?.degradedAt ?? now : current?.degradedAt ?? null,
    blockedAt:
      isMapImageBreakerV2Enabled() && recentFailures.length >= BLOCKED_HOST_FAILURE_THRESHOLD
        ? current?.blockedAt ?? now
        : current?.blockedAt ?? null,
    recentFailures,
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
  return resolveHostState(host, scope, Date.now()) !== 'healthy'
}

export function resolveHostState(
  host: string | null,
  scope: MapImageHostPolicyScope = 'default',
  now: number,
): MapImageHostState {
  const key = toScopedHostKey(host, scope)
  if (!key) return 'healthy'
  const current = readActiveHostRecord(key, now)
  if (!current) return 'healthy'
  if (isMapImageBreakerV2Enabled() && current.blockedAt != null) return 'blocked'
  if (current.degradedAt != null) return 'degraded'
  return 'healthy'
}

export function resolveHostTimeoutMs(
  host: string | null,
  scope: MapImageHostPolicyScope,
  defaultMs: number,
  now: number,
): number {
  if (!isMapImageBreakerV2Enabled()) return defaultMs
  const state = resolveHostState(host, scope, now)
  if (state === 'blocked') return 0
  if (state === 'degraded') return DEGRADED_HOST_TIMEOUT_MS
  return defaultMs
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
  if (resolveHostState(host, scope, Date.now()) === 'healthy') return [...urls]
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
