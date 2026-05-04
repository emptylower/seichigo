import { stripMapImageDiagnosticParams } from '@/lib/anitabi/imageProxy'

type RenderCacheState = 'HIT' | 'MISS' | 'BYPASS'

type WorkerRenderCache = {
  match(request: Request | string): Promise<Response | undefined>
  put(request: Request | string, response: Response): Promise<unknown>
}

function getWorkerRenderCache(): WorkerRenderCache | null {
  const cacheStorage = (globalThis as typeof globalThis & {
    caches?: { default?: WorkerRenderCache }
  }).caches
  return cacheStorage?.default ?? null
}

function buildRenderCacheKey(requestUrl: URL): Request {
  const canonicalUrl = stripMapImageDiagnosticParams(requestUrl)
  for (const key of ['name', '_retry']) canonicalUrl.searchParams.delete(key)
  return new Request(canonicalUrl.toString(), { method: 'GET' })
}

function parseRenderTargetUrl(rawInput: string | null | undefined, requestUrl: URL): URL | null {
  const raw = String(rawInput || '').trim()
  if (!raw) return null
  try {
    const url = raw.includes('://')
      ? new URL(raw)
      : new URL(raw.startsWith('/') ? raw : `/${raw.replace(/^\/+/, '')}`, requestUrl.origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.username || url.password ? null : url
  } catch {
    return null
  }
}

function resolveRenderOriginalSource(requestUrl: URL): string | null {
  return parseRenderTargetUrl(requestUrl.searchParams.get('url'), requestUrl)?.toString() ?? null
}

function parseAbsoluteHttpUrl(rawInput: string | null | undefined): string | null {
  const raw = String(rawInput || '').trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
      return null
    }
    return url.toString()
  } catch {
    return null
  }
}

export function resolveRenderCacheDiagnosticSource(input: {
  cachedOriginalSource?: string | null
  requestUrl: URL
}): string | null {
  return parseAbsoluteHttpUrl(input.cachedOriginalSource) ?? resolveRenderOriginalSource(input.requestUrl)
}

export function normalizeUrlHostname(input: string | null | undefined): string | undefined {
  const raw = String(input || '').trim()
  if (!raw) return undefined
  try {
    return new URL(raw).hostname.trim().toLowerCase().replace(/\.$/, '') || undefined
  } catch {
    return undefined
  }
}

function withRenderCacheState(
  response: Response,
  state: RenderCacheState,
  input?: { originalSource?: string | null }
): Response {
  const headers = new Headers(response.headers)
  headers.set('X-Seichigo-Render-Cache', state)
  const originalSource = String(headers.get('X-Original-Source') || input?.originalSource || '').trim()
  if (originalSource) {
    headers.set('X-Original-Source', originalSource)
  }
  return new Response(response.body, { status: response.status, headers })
}

export async function matchRenderCache(requestUrl: URL): Promise<{
  response: Response
  cachedOriginalSource: string | null
} | null> {
  const cache = getWorkerRenderCache()
  if (!cache) return null
  try {
    const cached = await cache.match(buildRenderCacheKey(requestUrl))
    if (!cached) return null
    return {
      response: withRenderCacheState(cached, 'HIT', {
        originalSource: resolveRenderOriginalSource(requestUrl),
      }),
      cachedOriginalSource: cached.headers.get('X-Original-Source'),
    }
  } catch {
    return null
  }
}

export async function storeRenderCache(requestUrl: URL, response: Response): Promise<Response> {
  const cache = getWorkerRenderCache()
  const responseWithState = withRenderCacheState(response, cache ? 'MISS' : 'BYPASS')
  if (!cache) return responseWithState
  try {
    await cache.put(buildRenderCacheKey(requestUrl), responseWithState.clone())
  } catch {
    // Cache write failures should not block image delivery.
  }
  return responseWithState
}
