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
    headers.set('content-type', asset.contentType || 'application/octet-stream')
    headers.set('cache-control', 'public, max-age=31536000, immutable')
    const bytes = asset.bytes
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    return new Response(body, { status: 200, headers })
  }
}
