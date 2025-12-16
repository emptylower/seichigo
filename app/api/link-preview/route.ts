import { NextResponse } from 'next/server'
import net from 'node:net'

export const runtime = 'nodejs'

const MAX_HTML_BYTES = 1024 * 1024
const FETCH_TIMEOUT_MS = 6_000

function json(data: unknown, init: ResponseInit = {}) {
  return NextResponse.json(data, init)
}

function normalizeHttpUrl(input: unknown): URL | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return url
}

function isPrivateIp(hostname: string): boolean {
  const ipType = net.isIP(hostname)
  if (!ipType) return false

  if (ipType === 4) {
    const parts = hostname.split('.').map((x) => Number(x))
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return true
    const [a, b] = parts
    if (a === 10) return true
    if (a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    return false
  }

  const lowered = hostname.toLowerCase()
  if (lowered === '::1') return true
  if (lowered.startsWith('fc') || lowered.startsWith('fd')) return true
  return false
}

function isDisallowedHost(hostname: string): boolean {
  const lowered = hostname.trim().toLowerCase()
  if (!lowered) return true
  if (lowered === 'localhost') return true
  if (lowered.endsWith('.localhost')) return true
  if (isPrivateIp(lowered)) return true
  return false
}

async function readTextWithLimit(res: Response, maxBytes: number): Promise<string> {
  const len = Number(res.headers.get('content-length') || '')
  if (Number.isFinite(len) && len > maxBytes) {
    throw new Error('response_too_large')
  }

  if (!res.body) {
    return await res.text()
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let received = 0
  let out = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    received += value.byteLength
    if (received > maxBytes) {
      try {
        reader.cancel()
      } catch {}
      throw new Error('response_too_large')
    }
    out += decoder.decode(value, { stream: true })
  }
  out += decoder.decode()
  return out
}

function parseTagAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([a-zA-Z0-9_:\-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(tag))) {
    const key = String(m[1] || '').trim().toLowerCase()
    const value = String(m[2] ?? m[3] ?? m[4] ?? '').trim()
    if (!key) continue
    if (value) attrs[key] = value
  }
  return attrs
}

function extractPreviewImage(html: string): string | null {
  const priorityKeys = ['og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image:src', 'twitter:image']
  const found = new Map<string, string>()

  const re = /<meta\b[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const tag = m[0] || ''
    const attrs = parseTagAttributes(tag)
    const key = String(attrs.property || attrs.name || '').trim().toLowerCase()
    const content = String(attrs.content || '').trim()
    if (!key || !content) continue
    if (!priorityKeys.includes(key)) continue
    if (!found.has(key)) found.set(key, content)
  }

  for (const key of priorityKeys) {
    const value = found.get(key)
    if (value) return value
  }
  return null
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const url = normalizeHttpUrl(body?.url)
  if (!url) {
    return json({ error: 'URL 不合法' }, { status: 400 })
  }
  if (isDisallowedHost(url.hostname)) {
    return json({ error: '不支持该域名' }, { status: 400 })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'SeichiGoLinkPreview/1.0',
      },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!res.ok) {
      return json({ error: '网页读取失败' }, { status: 502 })
    }

    const html = await readTextWithLimit(res, MAX_HTML_BYTES)
    const rawImage = extractPreviewImage(html)
    if (!rawImage) {
      return json({ error: '未找到预览图' }, { status: 404 })
    }

    let resolved: URL
    try {
      resolved = new URL(rawImage, url)
    } catch {
      return json({ error: '预览图地址不合法' }, { status: 422 })
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return json({ error: '预览图地址不合法' }, { status: 422 })
    }

    return json({ ok: true, imageUrl: resolved.toString() })
  } catch (err: any) {
    if (String(err?.name || '') === 'AbortError') {
      return json({ error: '网页读取超时' }, { status: 504 })
    }
    if (String(err?.message || '') === 'response_too_large') {
      return json({ error: '网页过大，无法提取预览图' }, { status: 413 })
    }
    return json({ error: '预览图提取失败' }, { status: 500 })
  } finally {
    clearTimeout(timeout)
  }
}

