import type { AssetRepo } from './repo'

type SessionLike = { user?: { id?: string | null } | null } | null
type GetSession = () => Promise<SessionLike>

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers)
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8')
  }
  return new Response(JSON.stringify(data), { ...init, headers })
}

function resolveMaxBytes() {
  const fallback = 3_500_000
  const raw = process.env.ASSET_MAX_BYTES
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

function normalizeParam(value: string | string[] | undefined): string | null {
  if (!value) return null
  if (Array.isArray(value)) return value[0] ?? null
  return value
}

export function createPostAssetsHandler(options: {
  assetRepo: AssetRepo
  getSession: GetSession
}) {
  return async function postAssets(req: Request) {
    const session = await options.getSession()
    const ownerId = session?.user?.id
    if (!ownerId) {
      return json({ error: '请先登录' }, { status: 401 })
    }

    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return json({ error: '无效的表单数据' }, { status: 400 })
    }

    const file = form.get('file')
    if (!file || typeof file !== 'object' || typeof (file as any).arrayBuffer !== 'function') {
      return json({ error: '缺少文件' }, { status: 400 })
    }

    const contentType = String((file as any).type || '').trim()
    if (!contentType.startsWith('image/')) {
      return json({ error: '仅支持上传图片' }, { status: 400 })
    }

    const arrayBuffer = await (file as File).arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)
    const maxBytes = resolveMaxBytes()
    if (bytes.byteLength > maxBytes) {
      return json({ error: '文件过大' }, { status: 413 })
    }

    const filename = typeof (file as any).name === 'string' && (file as any).name.trim() ? String((file as any).name).trim() : null

    const created = await options.assetRepo.create({
      ownerId,
      contentType,
      filename,
      bytes,
    })

    return json({ id: created.id, url: `/assets/${created.id}` })
  }
}

export function createGetAssetHandler(options: { assetRepo: AssetRepo }) {
  return async function getAsset(_req: Request, ctx: { params?: Promise<Record<string, string | string[] | undefined>> }) {
    const params = (await ctx.params) ?? {}
    const id = normalizeParam(params.id)
    if (!id) return new Response('Not found', { status: 404 })

    const asset = await options.assetRepo.findById(id)
    if (!asset) return new Response('Not found', { status: 404 })

    const headers = new Headers()

    const requestUrl = (() => {
      try {
        return new URL(_req.url)
      } catch {
        return null
      }
    })()

    const variant = requestUrl ? parseImageVariantRequest(requestUrl) : null
    const hasVariant = Boolean(variant)
    const isImage = (asset.contentType || '').startsWith('image/')
    const canTransform = isImage && !isSvg(asset.contentType) && !isGif(asset.contentType)

    if (hasVariant && canTransform) {
      try {
        const rendered = await renderWebpVariant(asset.bytes, variant!)
        headers.set('content-type', 'image/webp')
        headers.set('cache-control', 'public, max-age=31536000, immutable')
        return new Response(toArrayBuffer(rendered), { status: 200, headers })
      } catch {
        // Fallback to original bytes (compat over failure).
      }
    }

    headers.set('content-type', asset.contentType || 'application/octet-stream')
    headers.set('cache-control', 'public, max-age=31536000, immutable')
    return new Response(toArrayBuffer(asset.bytes), { status: 200, headers })
  }
}

function isSvg(contentType: string | null | undefined): boolean {
  const v = String(contentType || '').trim().toLowerCase()
  return v === 'image/svg+xml'
}

function isGif(contentType: string | null | undefined): boolean {
  const v = String(contentType || '').trim().toLowerCase()
  return v === 'image/gif'
}

function parsePositiveInt(value: string | null, opts: { min: number; max: number }): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!/^\d+$/.test(trimmed)) return null
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return null
  const m = Math.trunc(n)
  if (m < opts.min || m > opts.max) return null
  return m
}

function parseImageVariantRequest(url: URL): { width: number; quality: number } | null {
  const width = parsePositiveInt(url.searchParams.get('w'), { min: 16, max: 4096 })
  if (!width) return null
  const quality = parsePositiveInt(url.searchParams.get('q'), { min: 20, max: 95 }) ?? 75
  return { width, quality }
}

async function renderWebpVariant(bytes: Uint8Array, variant: { width: number; quality: number }): Promise<Uint8Array> {
  const { default: sharp } = await import('sharp')
  const input = Buffer.from(bytes)
  const out = await sharp(input, { failOnError: false })
    .rotate()
    .resize({ width: variant.width, withoutEnlargement: true })
    .webp({ quality: variant.quality })
    .toBuffer()
  return new Uint8Array(out)
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
