// Smoke-check that /api/ai is mounted and always returns JSON.
//
// Usage:
//   node scripts/ai-api-smoke.mjs
//   AI_API_BASE_URL=https://seichigo.com/api/ai node scripts/ai-api-smoke.mjs

const baseUrl = process.env.AI_API_BASE_URL || 'http://localhost:3000/api/ai'

function joinUrl(base, path) {
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  const normalizedPath = String(path || '').replace(/^\/+/, '')
  return new URL(normalizedPath, normalizedBase).toString()
}

async function assertJsonEndpoint(path, expectedStatuses) {
  const url = joinUrl(baseUrl, path)
  const res = await fetch(url, { redirect: 'manual' })

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

await assertJsonEndpoint('', [200, 401, 403])
await assertJsonEndpoint('articles', [200, 401, 403])
await assertJsonEndpoint('articles/not-a-real-id', [200, 401, 403, 400, 404])
await assertJsonEndpoint('no-such-endpoint', [401, 403, 404])
