import { NextResponse } from 'next/server'
import { lookup } from 'node:dns/promises'
import net from 'node:net'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'
import { buildContentDisposition, buildDownloadFilename } from '@/lib/anitabi/handlers/imageServeDownload'
import {
  matchRenderCache,
  normalizeUrlHostname,
  resolveRenderCacheDiagnosticSource,
  storeRenderCache,
} from '@/lib/anitabi/handlers/imageServeRenderCache'
import { getMirroredImage, putMirroredImage, type R2MirrorBucket } from '@/lib/anitabi/r2Mirror'
import { dispatchMapImageProxyEvent } from '@/lib/mapImageDiag/proxy'
const DOWNLOAD_FETCH_TIMEOUT_MS = 12_000
const RENDER_FETCH_TIMEOUT_MS = 6_000
const POINT_RENDER_FETCH_TIMEOUT_MS = 8_500
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_REDIRECTS = 5
const EXTRA_ALLOWED_IMAGE_HOSTS = ['anitabi.cn', 'bgm.tv']
const RENDER_CACHE_CONTROL = 'public, s-maxage=86400, stale-while-revalidate=604800'
const RENDER_UPSTREAM_CACHE_TTL_SECONDS = 86400
type ImageRouteMode = 'download' | 'render'
type MirroredImage = NonNullable<Awaited<ReturnType<typeof getMirroredImage>>>
function normalizeHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, '')
}
function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}
function resolveRenderTimeoutMs(target: URL): number {
  const baseTimeoutMs = parsePositiveInt(process.env.ANITABI_IMAGE_RENDER_TIMEOUT_MS, RENDER_FETCH_TIMEOUT_MS)
  const path = target.pathname.trim().toLowerCase()
  return path.startsWith('/points/') || path.includes('/points/')
    ? Math.max(baseTimeoutMs, parsePositiveInt(process.env.ANITABI_POINT_IMAGE_RENDER_TIMEOUT_MS, POINT_RENDER_FETCH_TIMEOUT_MS))
    : baseTimeoutMs
}
function parseContentLength(rawValue: string | null): number | null {
  if (rawValue == null) return null
  const trimmed = rawValue.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}
function scheduleLazyMirrorWrite(deps: AnitabiApiDeps, target: URL, mimeType: string, response: Response): void {
  const bucket = deps.env?.MAP_IMAGE_CACHE
  if (!bucket || deps.env?.NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED !== '1') return
  const writePromise = readBytesWithLimit(response.clone(), MAX_IMAGE_BYTES)
    .then((bytes) => putMirroredImage(bucket, target.toString(), bytes, mimeType, 'lazy'))
    .catch((error: unknown) => {
      if (String((error as Error)?.message || '') !== 'response_too_large') console.warn('[anitabi/imageServe] lazy mirror write failed', error)
    })
  if (deps.ctx?.waitUntil) deps.ctx.waitUntil(writePromise)
  else void writePromise
}
function parseTargetUrl(rawInput: string | null | undefined, requestUrl: URL): URL | null {
  const raw = String(rawInput || '').trim()
  if (!raw) return null
  try {
    const url = raw.includes('://')
      ? new URL(raw)
      : new URL(raw.startsWith('/') ? raw : `/${raw.replace(/^\/+/, '')}`, requestUrl.origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.protocol === 'http:' || url.protocol === 'https:' ? (url.username || url.password ? null : url) : null
  } catch {
    return null
  }
}
function hostMatches(host: string, allowed: string): boolean {
  return Boolean(host && allowed) && (host === allowed || host.endsWith(`.${allowed}`))
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
  return !host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || isPrivateIp(host)
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

function resolveSiteHost(deps: AnitabiApiDeps): string { try { return normalizeHost(new URL(deps.getSiteBase()).hostname) } catch { return '' } }

async function assertAllowedTargetUrl(
  target: URL,
  requestUrl: URL,
  deps: AnitabiApiDeps
): Promise<NextResponse | null> {
  const reqHost = normalizeHost(requestUrl.hostname)
  const siteHost = resolveSiteHost(deps)
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
  | { ok: true; response: Response; finalUrl: URL; mimeType: string; clearTimeout: () => void; abort: () => void }
  | { ok: false; response: NextResponse; clearTimeout: () => void; abort: () => void }
> {
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
  onStreamSuccess?: () => void
  onStreamError?: (outcome: string) => void
}): ReadableStream<Uint8Array> {
  const reader = input.body.getReader()
  let total = 0
  let finished = false

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return

      let timeoutId: ReturnType<typeof setTimeout> | null = null
      try {
        const result = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(new Error('stream_timeout'))
            }, input.timeoutMs)
          }),
        ])
        if (timeoutId != null) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        const { done, value } = result
        if (finished) return
        if (done) {
          finished = true
          input.onStreamSuccess?.()
          controller.close()
          return
        }
        if (!value) return

        total += value.byteLength
        if (total > input.maxBytes) {
          finished = true
          input.onLimitExceeded()
          input.onStreamError?.('response_too_large')
          controller.error(new Error('response_too_large'))
          return
        }

        controller.enqueue(value)
      } catch (err) {
        if (finished) return
        finished = true
        if (timeoutId != null) {
          clearTimeout(timeoutId)
        }
        if ((err as Error)?.message === 'stream_timeout') {
          input.onLimitExceeded()
          input.onStreamError?.('timeout')
        } else if ((err as Error)?.message === 'response_too_large') {
          input.onStreamError?.('response_too_large')
        } else {
          input.onStreamError?.('aborted')
        }
        controller.error(err)
      }
    },
    async cancel(reason) {
      if (finished) return
      finished = true
      input.onLimitExceeded()
      input.onStreamError?.('aborted')
      await reader.cancel(reason).catch(() => {})
    },
  })
}

async function buildRenderResponse(input: {
  upstream: Response
  mimeType: string
  originalSource: string
  imageSource: 'upstream-no-r2' | 'upstream-with-r2-write'
  abort: () => void
  timeoutMs: number
  onStreamSuccess?: () => void
  onStreamError?: (outcome: string) => void
}): Promise<Response> {
  const contentLength = parseContentLength(input.upstream.headers.get('content-length'))
  const headers = new Headers({
    'Content-Type': input.mimeType,
    'Cache-Control': RENDER_CACHE_CONTROL,
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
    'X-Original-Source': input.originalSource,
    'X-Seichigo-Image-Source': input.imageSource,
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
        onStreamSuccess: input.onStreamSuccess,
        onStreamError: input.onStreamError,
      }),
      {
        status: 200,
        headers,
      }
    )
  }

  const bytes = await readBytesWithLimit(input.upstream, MAX_IMAGE_BYTES)
  headers.set('Content-Length', String(bytes.byteLength))
  input.onStreamSuccess?.()
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

async function loadMirroredRenderResponse(
  bucket: R2MirrorBucket,
  rawUrl: string,
  source: 'r2-primary' | 'r2-fallback',
): Promise<{ mirrored: MirroredImage; response: Response } | null> {
  const mirrored = await getMirroredImage(bucket, rawUrl).catch(() => null)
  if (!mirrored) return null

  const mirroredSize = mirrored.size ?? mirrored.bytes.byteLength
  if (mirroredSize > MAX_IMAGE_BYTES) return null

  const headers = new Headers({
    'Content-Type': mirrored.httpContentType || mirrored.customMetadata.mimeType || 'image/jpeg',
    'Cache-Control': RENDER_CACHE_CONTROL,
    'Content-Disposition': 'inline',
    'X-Content-Type-Options': 'nosniff',
    'X-Seichigo-Image-Source': source,
    'X-Original-Source': mirrored.customMetadata.originalUrl || rawUrl,
  })
  if (mirroredSize >= 0) {
    headers.set('Content-Length', String(mirroredSize))
  }
  if (mirrored.customMetadata.mirroredAt) {
    headers.set('X-Seichigo-Image-Mirrored-At', mirrored.customMetadata.mirroredAt)
  }

  return {
    mirrored,
    response: new Response(mirrored.bytes, { status: 200, headers }),
  }
}

export async function serveImageRequest(
  req: Request,
  deps: AnitabiApiDeps,
  mode: ImageRouteMode
): Promise<Response> {
  const requestUrl = new URL(req.url)
  let imageCacheStateEmitted = false
  const emitProxyEvent = (input: Parameters<typeof dispatchMapImageProxyEvent>[2]) => {
    if (mode !== 'render') return
    dispatchMapImageProxyEvent(deps.prisma, requestUrl, input)
  }
  const emitImageCacheState = (
    input: Omit<Parameters<typeof dispatchMapImageProxyEvent>[2], 'stage'>
  ) => {
    if (mode !== 'render' || imageCacheStateEmitted) return
    imageCacheStateEmitted = true
    emitProxyEvent({
      stage: 'image_cache_state',
      ...input,
    })
  }
  if (mode === 'render' && requestUrl.searchParams.has('name')) {
    const canonicalUrl = new URL(requestUrl)
    canonicalUrl.searchParams.delete('name')
    return NextResponse.redirect(canonicalUrl, { status: 307 })
  }
  if (mode === 'render') {
    const cached = await matchRenderCache(requestUrl)
    if (cached) {
      emitProxyEvent({
        stage: 'proxy_cache_state',
        outcome: 'cache_hit',
        terminalState: 'succeeded',
      })
      const originalSource = resolveRenderCacheDiagnosticSource({
        cachedOriginalSource: cached.cachedOriginalSource,
        requestUrl,
      })
      emitImageCacheState({
        outcome: 'cache_hit_cf',
        terminalState: 'succeeded',
        targetHostBucket: normalizeUrlHostname(originalSource),
        evidence: originalSource ? { originalSource } : undefined,
      })
      return cached.response
    }
    emitProxyEvent({
      stage: 'proxy_cache_state',
      outcome: 'cache_miss',
    })
  }
  const target = parseTargetUrl(requestUrl.searchParams.get('url'), requestUrl)
  if (!target) {
    if (mode === 'render') {
      emitProxyEvent({
        stage: 'proxy_target_parse',
        outcome: 'rejected',
        terminalState: 'failed',
      })
    }
    return NextResponse.json({ error: '参数错误' }, { status: 400 })
  }
  const renderTimeoutMs = mode === 'render' ? resolveRenderTimeoutMs(target) : DOWNLOAD_FETCH_TIMEOUT_MS
  const renderR2ReadEnabled = (
    mode === 'render'
    && Boolean(deps.env?.MAP_IMAGE_CACHE)
    && (deps.env?.NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED ?? process.env.NEXT_PUBLIC_MAP_IMAGE_R2_READ_ENABLED) === '1'
  )
  if (mode === 'render') {
    emitProxyEvent({
      stage: 'proxy_target_parse',
      targetHostBucket: normalizeHost(target.hostname),
      evidence: { target: target.toString() },
    })
  }
  const blocked = await assertAllowedTargetUrl(target, requestUrl, deps)
  if (blocked) {
    if (mode === 'render') {
      emitProxyEvent({
        stage: 'proxy_allow_check',
        outcome: 'rejected',
        terminalState: 'failed',
        targetHostBucket: normalizeHost(target.hostname),
      })
    }
    return blocked
  }
  if (renderR2ReadEnabled && deps.env?.MAP_IMAGE_CACHE) {
    const mirrored = await loadMirroredRenderResponse(deps.env.MAP_IMAGE_CACHE, target.toString(), 'r2-primary')
    if (mirrored) {
      emitImageCacheState({
        outcome: 'cache_hit_r2_primary',
        terminalState: 'succeeded',
        targetHostBucket: normalizeHost(target.hostname),
        evidence: { mirrorSource: mirrored.mirrored.customMetadata.mirrorSource, r2Key: mirrored.mirrored.key },
      })
      return await storeRenderCache(requestUrl, mirrored.response)
    }
  }
  if (mode === 'render') {
    emitProxyEvent({
      stage: 'proxy_fetch_start',
      targetHostBucket: normalizeHost(target.hostname),
      evidence: { target: target.toString() },
    })
  }
  const fetchStartedAt = Date.now()
  const fetched = await fetchValidatedImage({
    target,
    requestUrl,
    deps,
    timeoutMs: renderTimeoutMs,
    userAgent: mode === 'render' ? 'SeichiGoImageRenderProxy/1.0' : 'SeichiGoImageDownload/1.0',
    useUpstreamEdgeCache: mode === 'render',
  })

  try {
    if (!fetched.ok) {
      if (mode === 'render') {
        const durationMs = Math.max(0, Date.now() - fetchStartedAt)
        const targetHostBucket = normalizeHost(target.hostname)
        if (fetched.response.status === 400) {
          emitProxyEvent({
            stage: 'proxy_allow_check',
            outcome: 'rejected',
            terminalState: 'failed',
            durationMs,
            targetHostBucket,
          })
        } else if (fetched.response.status === 415) {
          emitProxyEvent({
            stage: 'proxy_content_validate',
            outcome: 'content_invalid',
            terminalState: 'failed',
            durationMs,
            targetHostBucket,
          })
        } else {
          const upstreamFailureOutcome = fetched.response.status === 504 ? 'timeout' : 'network_error'
          if (renderR2ReadEnabled && deps.env?.MAP_IMAGE_CACHE) {
            const mirrored = await loadMirroredRenderResponse(deps.env.MAP_IMAGE_CACHE, target.toString(), 'r2-fallback')
            if (mirrored) {
              emitProxyEvent({
                stage: 'proxy_fetch_terminal',
                outcome: upstreamFailureOutcome,
                durationMs,
                targetHostBucket,
                evidence: {
                  recoveredBy: 'r2-fallback',
                  fallbackStatus: mirrored.response.status,
                },
              })
              emitImageCacheState({
                outcome: 'cache_hit_r2_fallback',
                terminalState: 'succeeded',
                targetHostBucket,
                evidence: { mirrorSource: mirrored.mirrored.customMetadata.mirrorSource, r2Key: mirrored.mirrored.key },
              })
              return await storeRenderCache(requestUrl, mirrored.response)
            }
          }
          emitProxyEvent({
            stage: 'proxy_fetch_terminal',
            outcome: upstreamFailureOutcome,
            terminalState: 'failed',
            durationMs,
            targetHostBucket,
          })
          emitImageCacheState({
            outcome: 'cache_full_miss_failed',
            terminalState: 'failed',
            targetHostBucket,
          })
        }
      }
      return fetched.response
    }

    if (mode === 'render') {
      const fetchDurationMs = Math.max(0, Date.now() - fetchStartedAt)
      emitProxyEvent({
        stage: 'proxy_fetch_terminal',
        durationMs: fetchDurationMs,
        targetHostBucket: normalizeHost(fetched.finalUrl.hostname),
        evidence: { finalUrl: fetched.finalUrl.toString() },
      })
      emitProxyEvent({
        stage: 'proxy_content_validate',
        targetHostBucket: normalizeHost(fetched.finalUrl.hostname),
        evidence: { mimeType: fetched.mimeType },
      })
      let streamTerminalEmitted = false
      const emitStreamTerminal = async (payload: {
        terminalState: 'succeeded' | 'failed' | 'aborted'
        outcome?: string
      }) => {
        if (streamTerminalEmitted) return
        streamTerminalEmitted = true
        emitProxyEvent({
          stage: 'proxy_stream_terminal',
          terminalState: payload.terminalState,
          outcome: payload.outcome,
          targetHostBucket: normalizeHost(fetched.finalUrl.hostname),
          evidence: { mimeType: fetched.mimeType },
        })
      }
      const renderResponse = await buildRenderResponse({
        upstream: fetched.response,
        mimeType: fetched.mimeType,
        originalSource: fetched.finalUrl.toString(),
        imageSource: deps.env?.MAP_IMAGE_CACHE && deps.env?.NEXT_PUBLIC_MAP_IMAGE_R2_WRITE_ENABLED === '1'
          ? 'upstream-with-r2-write'
          : 'upstream-no-r2',
        abort: fetched.abort,
        timeoutMs: renderTimeoutMs,
        onStreamSuccess: () => {
          void emitStreamTerminal({ terminalState: 'succeeded' })
        },
        onStreamError: (outcome) => {
          void emitStreamTerminal({
            terminalState: outcome === 'aborted' ? 'aborted' : 'failed',
            outcome,
          })
        },
      })
      emitImageCacheState({
        outcome: 'cache_miss_all',
        terminalState: 'succeeded',
        targetHostBucket: normalizeHost(fetched.finalUrl.hostname),
        evidence: {
          finalUrl: fetched.finalUrl.toString(),
          mimeType: fetched.mimeType,
        },
      })
      scheduleLazyMirrorWrite(deps, target, fetched.mimeType, renderResponse)
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
      if (mode === 'render') {
        emitProxyEvent({
          stage: 'proxy_stream_terminal',
          terminalState: 'failed',
          outcome: 'response_too_large',
          targetHostBucket: fetched.ok ? normalizeHost(fetched.finalUrl.hostname) : normalizeHost(target.hostname),
          evidence: fetched.ok ? { mimeType: fetched.mimeType } : undefined,
        })
      }
      return NextResponse.json({ error: '图片文件过大' }, { status: 413 })
    }
    const message = mode === 'render' ? '图片代理失败' : '图片下载失败'
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    fetched.clearTimeout()
  }
}
