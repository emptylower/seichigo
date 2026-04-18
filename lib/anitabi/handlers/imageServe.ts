import { NextResponse } from 'next/server'
import { lookup } from 'node:dns/promises'
import net from 'node:net'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'

const DOWNLOAD_FETCH_TIMEOUT_MS = 12_000
const RENDER_FETCH_TIMEOUT_MS = 6_000
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_REDIRECTS = 5
const EXTRA_ALLOWED_IMAGE_HOSTS = ['anitabi.cn', 'bgm.tv']
const RENDER_CACHE_CONTROL = 'public, s-maxage=86400, stale-while-revalidate=604800'
const RENDER_UPSTREAM_CACHE_TTL_SECONDS = 86400

type ImageRouteMode = 'download' | 'render'
type RenderCacheState = 'HIT' | 'MISS' | 'BYPASS'
type WorkerRenderCache = {
  match(request: Request | string): Promise<Response | undefined>
  put(request: Request | string, response: Response): Promise<unknown>
}

function normalizeHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, '')
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed)
  }
  return fallback
}

function getRenderTimeoutMs(): number {
  return parsePositiveInt(process.env.ANITABI_IMAGE_RENDER_TIMEOUT_MS, RENDER_FETCH_TIMEOUT_MS)
}

function parseContentLength(rawValue: string | null): number | null {
  if (rawValue == null) return null
  const trimmed = rawValue.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

function getWorkerRenderCache(): WorkerRenderCache | null {
  const cacheStorage = (globalThis as typeof globalThis & {
    caches?: { default?: WorkerRenderCache }
  }).caches
  return cacheStorage?.default ?? null
}

function buildRenderCacheKey(requestUrl: URL): Request {
  const canonicalUrl = new URL(requestUrl)
  canonicalUrl.searchParams.delete('name')
  return new Request(canonicalUrl.toString(), { method: 'GET' })
}

function withRenderCacheState(response: Response, state: RenderCacheState): Response {
  const headers = new Headers(response.headers)
  headers.set('X-Seichigo-Render-Cache', state)
  return new Response(response.body, {
    status: response.status,
    headers,
  })
}

async function matchRenderCache(requestUrl: URL): Promise<Response | null> {
  const cache = getWorkerRenderCache()
  if (!cache) return null

  try {
    const cached = await cache.match(buildRenderCacheKey(requestUrl))
    if (!cached) return null
    return withRenderCacheState(cached, 'HIT')
  } catch {
    return null
  }
}

async function storeRenderCache(requestUrl: URL, response: Response): Promise<Response> {
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

function parseTargetUrl(rawInput: string | null | undefined, requestUrl: URL): URL | null {
  const raw = String(rawInput || '').trim()
  if (!raw) return null

  try {
    const url = raw.includes('://')
      ? new URL(raw)
      : new URL(raw.startsWith('/') ? raw : `/${raw.replace(/^\/+/, '')}`, requestUrl.origin)

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    return url
  } catch {
    return null
  }
}

function hostMatches(host: string, allowed: string): boolean {
  if (!host || !allowed) return false
  if (host === allowed) return true
  return host.endsWith(`.${allowed}`)
}

function isPrivateIp(hostname: string): boolean {
  const ipType = net.isIP(hostname)
  if (!ipType) return false

  if (ipType === 4) {
    const parts = hostname.split('.').map((x) => Number(x))
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return true
    const [a, b] = parts
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a >= 224) return true
    return false
  }

  const lowered = hostname.toLowerCase()
  if (lowered === '::' || lowered === '::1') return true
  if (lowered.startsWith('::ffff:')) {
    return isPrivateIp(lowered.slice('::ffff:'.length))
  }
  if (lowered.startsWith('fc') || lowered.startsWith('fd')) return true
  if (lowered.startsWith('fe8') || lowered.startsWith('fe9') || lowered.startsWith('fea') || lowered.startsWith('feb')) return true
  return false
}

function isDisallowedHost(hostname: string): boolean {
  const host = normalizeHost(hostname)
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (isPrivateIp(host)) return true
  return false
}

async function resolvesToDisallowedIp(hostname: string): Promise<boolean> {
  const host = normalizeHost(hostname)
  if (!host) return true
  if (net.isIP(host)) return isPrivateIp(host)

  try {
    const records = await lookup(host, { all: true, verbatim: true })
    if (!records.length) return true
    return records.some((record) => isPrivateIp(String(record.address || '').trim()))
  } catch {
    return true
  }
}

async function readBytesWithLimit(res: Response, maxBytes: number): Promise<ArrayBuffer> {
  const contentLength = parseContentLength(res.headers.get('content-length'))
  if (contentLength != null && contentLength > maxBytes) {
    throw new Error('response_too_large')
  }

  if (!res.body) {
    const bytes = await res.arrayBuffer()
    if (bytes.byteLength > maxBytes) throw new Error('response_too_large')
    return bytes
  }

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue

    total += value.byteLength
    if (total > maxBytes) {
      try {
        await reader.cancel()
      } catch {
        // noop
      }
      throw new Error('response_too_large')
    }
    chunks.push(value)
  }

  const buffer = new ArrayBuffer(total)
  const out = new Uint8Array(buffer)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return buffer
}

function parseContentDispositionFilename(value: string | null): string | null {
  if (!value) return null

  const utf8Match = value.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      const decoded = decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ''))
      if (decoded) return decoded
    } catch {
      // noop
    }
  }

  const plainMatch = value.match(/filename\s*=\s*"?([^";]+)"?/i)
  if (plainMatch?.[1]) {
    const name = plainMatch[1].trim()
    if (name) return name
  }

  return null
}

function extensionFromPath(input: string | null | undefined): string | null {
  const text = String(input || '').trim()
  if (!text) return null
  const match = text.match(/\.([a-zA-Z0-9]{2,6})$/)
  if (!match?.[1]) return null
  return `.${match[1].toLowerCase()}`
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

function sanitizeFilenameBase(input: string | null | undefined): string {
  const cleaned = String(input || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return 'anitabi-image'
  return cleaned.slice(0, 80)
}

function trimFileExtension(input: string): string {
  return input.replace(/\.[a-zA-Z0-9]{2,6}$/, '')
}

function buildDownloadFilename(input: {
  mimeType: string
  pathname: string
  hintName: string | null
  upstreamDisposition: string | null
}): string {
  const fromDisposition = parseContentDispositionFilename(input.upstreamDisposition)
  const fromPath = decodeURIComponent(input.pathname.split('/').filter(Boolean).pop() || '')

  const preferred = fromDisposition || input.hintName || fromPath || 'anitabi-image'
  const base = sanitizeFilenameBase(trimFileExtension(preferred))
  const ext = extensionFromPath(fromDisposition) || extensionFromPath(fromPath) || extensionFromMimeType(input.mimeType)

  return `${base}${ext}`
}

function buildContentDisposition(filename: string): string {
  const safeUtf8 = filename.replace(/[\r\n]/g, '')
  const fallbackAscii = safeUtf8
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_')
    .trim() || 'anitabi-image.jpg'

  return `attachment; filename="${fallbackAscii}"; filename*=UTF-8''${encodeURIComponent(safeUtf8)}`
}

async function resolveSiteHost(deps: AnitabiApiDeps): Promise<string> {
  try {
    return normalizeHost(new URL(deps.getSiteBase()).hostname)
  } catch {
    return ''
  }
}

async function assertAllowedTargetUrl(
  target: URL,
  requestUrl: URL,
  deps: AnitabiApiDeps
): Promise<NextResponse | null> {
  const reqHost = normalizeHost(requestUrl.hostname)
  const siteHost = await resolveSiteHost(deps)
  const targetHost = normalizeHost(target.hostname)
  const hostAllowed =
    hostMatches(targetHost, reqHost) ||
    hostMatches(targetHost, siteHost) ||
    EXTRA_ALLOWED_IMAGE_HOSTS.some((allowedHost) => hostMatches(targetHost, allowedHost))

  if (!hostAllowed || isDisallowedHost(targetHost) || (await resolvesToDisallowedIp(targetHost))) {
    return NextResponse.json({ error: '不支持该图片来源' }, { status: 400 })
  }

  return null
}

async function fetchValidatedImage(input: {
  target: URL
  requestUrl: URL
  deps: AnitabiApiDeps
  timeoutMs: number
  userAgent: string
  useUpstreamEdgeCache?: boolean
}): Promise<
  | {
      ok: true
      response: Response
      finalUrl: URL
      mimeType: string
      clearTimeout: () => void
      abort: () => void
    }
  | {
      ok: false
      response: NextResponse
      clearTimeout: () => void
      abort: () => void
    }
> {
  const blocked = await assertAllowedTargetUrl(input.target, input.requestUrl, input.deps)
  if (blocked) {
    return {
      ok: false,
      response: blocked,
      clearTimeout: () => {},
      abort: () => {},
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs)
  let current = input.target

  try {
    for (let i = 0; i <= MAX_REDIRECTS; i += 1) {
      const redirectBlocked = await assertAllowedTargetUrl(current, input.requestUrl, input.deps)
      if (redirectBlocked) {
        return {
          ok: false,
          response: redirectBlocked,
          clearTimeout: () => clearTimeout(timeout),
          abort: () => controller.abort(),
        }
      }

      const requestInit: RequestInit & {
        cf?: {
          cacheEverything?: boolean
          cacheTtl?: number
          cacheKey?: string
        }
      } = {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          accept: 'image/*,*/*;q=0.8',
          'user-agent': input.userAgent,
        },
      }

      if (input.useUpstreamEdgeCache) {
        requestInit.cf = {
          cacheEverything: true,
          cacheTtl: RENDER_UPSTREAM_CACHE_TTL_SECONDS,
          cacheKey: current.toString(),
        }
      }

      const response = await fetch(current.toString(), requestInit)

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) {
          return {
            ok: false,
            response: NextResponse.json({ error: '图片读取失败' }, { status: 502 }),
            clearTimeout: () => clearTimeout(timeout),
            abort: () => controller.abort(),
          }
        }

        let nextUrl: URL
        try {
          nextUrl = new URL(location, current)
        } catch {
          return {
            ok: false,
            response: NextResponse.json({ error: '图片读取失败' }, { status: 502 }),
            clearTimeout: () => clearTimeout(timeout),
            abort: () => controller.abort(),
          }
        }

        if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
          return {
            ok: false,
            response: NextResponse.json({ error: '图片读取失败' }, { status: 502 }),
            clearTimeout: () => clearTimeout(timeout),
            abort: () => controller.abort(),
          }
        }

        current = nextUrl
        continue
      }

      if (!response.ok) {
        return {
          ok: false,
          response: NextResponse.json({ error: '图片读取失败' }, { status: 502 }),
          clearTimeout: () => clearTimeout(timeout),
          abort: () => controller.abort(),
        }
      }

      const mimeType = String(response.headers.get('content-type') || '').split(';')[0]?.trim().toLowerCase()
      if (!mimeType || !mimeType.startsWith('image/')) {
        return {
          ok: false,
          response: NextResponse.json({ error: '文件类型不支持' }, { status: 415 }),
          clearTimeout: () => clearTimeout(timeout),
          abort: () => controller.abort(),
        }
      }

      return {
        ok: true,
        response,
        finalUrl: current,
        mimeType,
        clearTimeout: () => clearTimeout(timeout),
        abort: () => controller.abort(),
      }
    }

    return {
      ok: false,
      response: NextResponse.json({ error: '重定向过多' }, { status: 508 }),
      clearTimeout: () => clearTimeout(timeout),
      abort: () => controller.abort(),
    }
  } catch (err: any) {
    const isAbort = String(err?.name || '') === 'AbortError'
    const status = isAbort ? 504 : 500
    const message = isAbort ? '图片代理超时' : '图片代理失败'

    return {
      ok: false,
      response: NextResponse.json({ error: message }, { status }),
      clearTimeout: () => clearTimeout(timeout),
      abort: () => controller.abort(),
    }
  }
}

function buildStreamWithLimit(input: {
  body: ReadableStream<Uint8Array>
  maxBytes: number
  onLimitExceeded: () => void
  timeoutMs: number
}): ReadableStream<Uint8Array> {
  const reader = input.body.getReader()
  let total = 0
  let finished = false
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null

  const timeout = setTimeout(() => {
    if (finished) return
    finished = true
    input.onLimitExceeded()
    controllerRef?.error(new Error('stream_timeout'))
    void reader.cancel().catch(() => {})
  }, input.timeoutMs)

  function stop() {
    clearTimeout(timeout)
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller
    },
    async pull(controller) {
      if (finished) return

      try {
        const { done, value } = await reader.read()
        if (finished) return
        if (done) {
          finished = true
          stop()
          controller.close()
          return
        }
        if (!value) return

        total += value.byteLength
        if (total > input.maxBytes) {
          finished = true
          stop()
          input.onLimitExceeded()
          controller.error(new Error('response_too_large'))
          await reader.cancel().catch(() => {})
          return
        }

        controller.enqueue(value)
      } catch (err) {
        if (finished) return
        finished = true
        stop()
        controller.error(err)
      }
    },
    async cancel(reason) {
      if (finished) return
      finished = true
      stop()
      input.onLimitExceeded()
      await reader.cancel(reason).catch(() => {})
    },
  })
}

async function buildRenderResponse(input: {
  upstream: Response
  mimeType: string
  abort: () => void
  timeoutMs: number
}): Promise<Response> {
  const contentLength = parseContentLength(input.upstream.headers.get('content-length'))
  const headers = new Headers({
    'Content-Type': input.mimeType,
    'Cache-Control': RENDER_CACHE_CONTROL,
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
  })

  if (contentLength != null && contentLength > MAX_IMAGE_BYTES) {
    throw new Error('response_too_large')
  }

  if (input.upstream.body && contentLength != null) {
    headers.set('Content-Length', String(contentLength))
    return new Response(
      buildStreamWithLimit({
        body: input.upstream.body,
        maxBytes: MAX_IMAGE_BYTES,
        onLimitExceeded: input.abort,
        timeoutMs: input.timeoutMs,
      }),
      {
        status: 200,
        headers,
      }
    )
  }

  const bytes = await readBytesWithLimit(input.upstream, MAX_IMAGE_BYTES)
  headers.set('Content-Length', String(bytes.byteLength))
  return new Response(bytes, {
    status: 200,
    headers,
  })
}

async function buildDownloadResponse(input: {
  upstream: Response
  mimeType: string
  finalUrl: URL
  hintName: string | null
}): Promise<Response> {
  const bytes = await readBytesWithLimit(input.upstream, MAX_IMAGE_BYTES)
  const filename = buildDownloadFilename({
    mimeType: input.mimeType,
    pathname: input.finalUrl.pathname,
    hintName: input.hintName,
    upstreamDisposition: input.upstream.headers.get('content-disposition'),
  })

  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': input.mimeType,
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition': buildContentDisposition(filename),
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export async function serveImageRequest(
  req: Request,
  deps: AnitabiApiDeps,
  mode: ImageRouteMode
): Promise<Response> {
  const requestUrl = new URL(req.url)
  if (mode === 'render' && requestUrl.searchParams.has('name')) {
    const canonicalUrl = new URL(requestUrl)
    canonicalUrl.searchParams.delete('name')
    return NextResponse.redirect(canonicalUrl, { status: 307 })
  }
  const renderTimeoutMs = getRenderTimeoutMs()
  if (mode === 'render') {
    const cached = await matchRenderCache(requestUrl)
    if (cached) return cached
  }
  const target = parseTargetUrl(requestUrl.searchParams.get('url'), requestUrl)
  if (!target) {
    return NextResponse.json({ error: '参数错误' }, { status: 400 })
  }

  const fetched = await fetchValidatedImage({
    target,
    requestUrl,
    deps,
    timeoutMs: mode === 'render' ? renderTimeoutMs : DOWNLOAD_FETCH_TIMEOUT_MS,
    userAgent: mode === 'render' ? 'SeichiGoImageRenderProxy/1.0' : 'SeichiGoImageDownload/1.0',
    useUpstreamEdgeCache: mode === 'render',
  })

  try {
    if (!fetched.ok) {
      return fetched.response
    }

    if (mode === 'render') {
      const renderResponse = await buildRenderResponse({
        upstream: fetched.response,
        mimeType: fetched.mimeType,
        abort: fetched.abort,
        timeoutMs: renderTimeoutMs,
      })
      return await storeRenderCache(requestUrl, renderResponse)
    }

    return await buildDownloadResponse({
      upstream: fetched.response,
      mimeType: fetched.mimeType,
      finalUrl: fetched.finalUrl,
      hintName: requestUrl.searchParams.get('name'),
    })
  } catch (err: any) {
    if (String(err?.message || '') === 'response_too_large') {
      return NextResponse.json({ error: '图片文件过大' }, { status: 413 })
    }
    const message = mode === 'render' ? '图片代理失败' : '图片下载失败'
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    fetched.clearTimeout()
  }
}
