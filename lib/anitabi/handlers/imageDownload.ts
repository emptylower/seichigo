import { NextResponse } from 'next/server'
import { lookup } from 'node:dns/promises'
import net from 'node:net'
import type { AnitabiApiDeps } from '@/lib/anitabi/api'

const FETCH_TIMEOUT_MS = 12_000
const MAX_IMAGE_BYTES = 25 * 1024 * 1024

function normalizeHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, '')
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
  const contentLength = Number(res.headers.get('content-length') || '')
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
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

export function createHandlers(deps: AnitabiApiDeps) {
  return {
    async GET(req: Request) {
      const requestUrl = new URL(req.url)
      const target = parseTargetUrl(requestUrl.searchParams.get('url'), requestUrl)
      if (!target) {
        return NextResponse.json({ error: '参数错误' }, { status: 400 })
      }

      const reqHost = normalizeHost(requestUrl.hostname)
      let siteHost = ''
      try {
        siteHost = normalizeHost(new URL(deps.getSiteBase()).hostname)
      } catch {
        // noop
      }

      const targetHost = normalizeHost(target.hostname)
      const hostAllowed =
        hostMatches(targetHost, reqHost) ||
        hostMatches(targetHost, siteHost) ||
        hostMatches(targetHost, 'anitabi.cn')

      if (!hostAllowed || isDisallowedHost(targetHost) || (await resolvesToDisallowedIp(targetHost))) {
        return NextResponse.json({ error: '不支持该图片来源' }, { status: 400 })
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

      try {
        const upstream = await fetch(target.toString(), {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
          headers: {
            accept: 'image/*,*/*;q=0.8',
            'user-agent': 'SeichiGoImageDownload/1.0',
          },
        })

        const finalUrl = parseTargetUrl(upstream.url, requestUrl)
        if (!finalUrl) {
          return NextResponse.json({ error: '图片读取失败' }, { status: 502 })
        }

        const finalHost = normalizeHost(finalUrl.hostname)
        const finalHostAllowed =
          hostMatches(finalHost, reqHost) ||
          hostMatches(finalHost, siteHost) ||
          hostMatches(finalHost, 'anitabi.cn')

        if (!finalHostAllowed || isDisallowedHost(finalHost) || (await resolvesToDisallowedIp(finalHost))) {
          return NextResponse.json({ error: '图片读取失败' }, { status: 502 })
        }

        if (!upstream.ok) {
          return NextResponse.json({ error: '图片读取失败' }, { status: 502 })
        }

        const mimeType = String(upstream.headers.get('content-type') || '').split(';')[0]?.trim().toLowerCase()
        if (!mimeType || !mimeType.startsWith('image/')) {
          return NextResponse.json({ error: '文件类型不支持' }, { status: 415 })
        }

        const bytes = await readBytesWithLimit(upstream, MAX_IMAGE_BYTES)
        const filename = buildDownloadFilename({
          mimeType,
          pathname: finalUrl.pathname,
          hintName: requestUrl.searchParams.get('name'),
          upstreamDisposition: upstream.headers.get('content-disposition'),
        })

        return new Response(bytes, {
          status: 200,
          headers: {
            'Content-Type': mimeType,
            'Content-Length': String(bytes.byteLength),
            'Content-Disposition': buildContentDisposition(filename),
            'Cache-Control': 'private, no-store, max-age=0',
            'X-Content-Type-Options': 'nosniff',
          },
        })
      } catch (err: any) {
        if (String(err?.name || '') === 'AbortError') {
          return NextResponse.json({ error: '图片下载超时' }, { status: 504 })
        }
        if (String(err?.message || '') === 'response_too_large') {
          return NextResponse.json({ error: '图片文件过大' }, { status: 413 })
        }
        return NextResponse.json({ error: '图片下载失败' }, { status: 500 })
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}
