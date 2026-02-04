// Smoke-check that /api/ai is mounted and always returns JSON.
//
// Usage:
//   node scripts/ai-api-smoke.mjs
//   AI_API_BASE_URL=https://seichigo.com/api/ai node scripts/ai-api-smoke.mjs

const baseUrl = process.env.AI_API_BASE_URL || 'http://localhost:3000/api/ai'

function joinUrl(base, path) {
  if (!path) return String(base)
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  const normalizedPath = String(path).replace(/^\/+/, '')
  return new URL(normalizedPath, normalizedBase).toString()
}

function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

async function fetchFollowRedirects(url, options, maxHops = 5) {
  let currentUrl = url
  for (let i = 0; i <= maxHops; i++) {
    const res = await fetch(currentUrl, { ...options, redirect: 'manual' })
    if (!isRedirectStatus(res.status)) return res

    const location = res.headers.get('location')
    if (!location) {
      throw new Error(`[ai-api-smoke] ${currentUrl}: redirect ${res.status} without Location header`)
    }
    currentUrl = new URL(location, currentUrl).toString()
  }
  throw new Error(`[ai-api-smoke] ${url}: too many redirects`)
}

async function assertJsonEndpoint(path, expectedStatuses) {
  const url = joinUrl(baseUrl, path)
  const res = await fetchFollowRedirects(url, {}, 5)

  if (!expectedStatuses.includes(res.status)) {
    const body = await res.text().catch(() => '')
    throw new Error(`[ai-api-smoke] ${url}: expected ${expectedStatuses.join('/')}, got ${res.status}. body=${body.slice(0, 200)}`)
  }

  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('application/json')) {
    const body = await res.text().catch(() => '')
    throw new Error(`[ai-api-smoke] ${url}: expected JSON content-type, got ${ct || '(none)'}. body=${body.slice(0, 200)}`)
  }

  const json = await res.json()
  if (!json || typeof json !== 'object') {
    throw new Error(`[ai-api-smoke] ${url}: expected JSON object, got ${typeof json}`)
  }

  process.stdout.write(`[ok] ${url} -> ${res.status}\n`)
}

async function main() {
  await assertJsonEndpoint('', [200, 401, 403])
  await assertJsonEndpoint('articles', [200, 401, 403])
  await assertJsonEndpoint('articles/not-a-real-id', [200, 401, 403, 400, 404])
  await assertJsonEndpoint('no-such-endpoint', [401, 403, 404])
}

const isMain = import.meta.url === new URL(process.argv[1], 'file://').toString()
if (isMain) {
  await main()
}

export { joinUrl, fetchFollowRedirects, isRedirectStatus, assertJsonEndpoint, main }
