import type { Asset, AssetRepo } from './repo'
import type { AssetStore } from './store'
import { getAssetStore } from './store'
import {
  isGifContentType,
  isSvgContentType,
  normalizeImageForStorage,
  shouldNormalizeForStorage,
  uint8ArrayToStream,
} from './normalize'
import { getCfBindings, type CfBindings } from '@/lib/anitabi/cf/bindings'

type SessionLike = { user?: { id?: string | null; isAdmin?: boolean } | null } | null
type GetSession = () => Promise<SessionLike>
type ResolveOwnerResult = { ok: true; ownerId: string } | { ok: false; response: Response }
type ResolveOwnerId = (req: Request) => Promise<ResolveOwnerResult>

const ALLOWED_UPLOAD_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
])

/**
 * 2026-09-08 图片资产迁 R2：
 * - 上传归一化：非 GIF/AVIF 经 Images 绑定缩到最大宽 1600 转 WebP（质量 82）再存。
 * - 读路径全程流式：R2 原图流 → Images 绑定 → 输出；只有变体输出（几十 KB 级）
 *   会完整进内存。
 * - 同一 isolate 同时最多 MAX_CONCURRENT_TRANSFORMS 个"读原图并转换"操作，
 *   超出排队（R2 变体命中不占闸门），防止几张大 PNG 并发把 128MB 打爆。
 */
const MAX_CONCURRENT_TRANSFORMS = 3

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

function sanitizeFilename(value: string | null | undefined, fallback: string): string {
  const raw = String(value || '').trim()
  if (!raw) return fallback
  const cleaned = raw
    .replace(/[\r\n"]/g, '')
    .replace(/[\\/]/g, '_')
    .trim()
  return cleaned || fallback
}

function getRuntimeCache(): Cache | null {
  const runtimeCaches = (globalThis as typeof globalThis & {
    caches?: { default?: Cache }
  }).caches

  if (!runtimeCaches?.default) return null
  return runtimeCaches.default
}

async function putRuntimeCache(cache: Cache, url: string, response: Response): Promise<void> {
  await cache.put(url, response.clone()).catch(() => undefined)
}

async function streamToUint8Array(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** 变体写入 R2 这类后台收尾：有 waitUntil 就挂上去，拿不到（本地 dev）就 await */
function runBackground(promise: Promise<unknown>): Promise<void> {
  const guarded: Promise<void> = promise.then(
    () => undefined,
    (error) => {
      console.error('[asset.variant.put_failed]', {
        event: 'asset_image_variant_put_failed',
        error: error instanceof Error
          ? { name: error.name, message: error.message }
          : { message: String(error) },
      })
    },
  )
  // 必须以 ctx 为 this 调用：把 waitUntil 拆下来单独调用会抛 "Illegal invocation"
  //（2026-09-08 上线后实测，导致变体全部走转换失败兜底）
  const ctx = getCfBindings()?.ctx
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(guarded)
    return Promise.resolve()
  }
  return guarded
}

// ---- 模块级并发闸门：FIFO，最多 3 个"读原图并转换"同时在飞 ----

let transformGateActive = 0
const transformGateWaiters: Array<() => void> = []

async function acquireTransformSlot(): Promise<() => void> {
  if (transformGateActive >= MAX_CONCURRENT_TRANSFORMS) {
    await new Promise<void>((resolve) => {
      transformGateWaiters.push(resolve)
    })
  }
  transformGateActive++
  let released = false
  return () => {
    if (released) return
    released = true
    transformGateActive = Math.max(0, transformGateActive - 1)
    const next = transformGateWaiters.shift()
    if (next) next()
  }
}

// ---- 原图来源解析 ----

type OriginalSource = { stream: ReadableStream<Uint8Array> } | { bytes: Uint8Array }

async function openOriginal(
  asset: Asset,
  store: AssetStore | null,
  assetRepo: AssetRepo,
): Promise<OriginalSource | null> {
  if (store && asset.storageKey) {
    const original = await store.getOriginal(asset.storageKey).catch(() => null)
    if (original) return { stream: original.body }
  }
  const bytes = await assetRepo.findBytesById(asset.id)
  return bytes ? { bytes } : null
}

/** 需要完整字节的回落路径（SVG 加固、转换失败兜底）：只保留一份 Uint8Array */
async function loadOriginalBytes(
  asset: Asset,
  store: AssetStore | null,
  assetRepo: AssetRepo,
): Promise<Uint8Array | null> {
  if (store && asset.storageKey) {
    const original = await store.getOriginal(asset.storageKey).catch(() => null)
    if (original) return streamToUint8Array(original.body)
  }
  return assetRepo.findBytesById(asset.id)
}

// ---- Images 绑定辅助 ----

type ImagesBindingLike = NonNullable<NonNullable<CfBindings['env']>['IMAGES']>

function getImagesBinding(): ImagesBindingLike | null {
  return getCfBindings()?.env?.IMAGES ?? null
}

export function createPostAssetsHandler(options: {
  assetRepo: AssetRepo
  getSession: GetSession
}) {
  return createPostAssetsHandlerWithOwner({
    assetRepo: options.assetRepo,
    resolveOwnerId: async () => {
      const session = await options.getSession()
      const ownerId = String(session?.user?.id || '').trim()
      if (!ownerId) {
        return { ok: false, response: json({ error: '请先登录' }, { status: 401 }) }
      }
      return { ok: true, ownerId }
    },
  })
}

export function createPostAssetsHandlerWithOwner(options: {
  assetRepo: AssetRepo
  resolveOwnerId: ResolveOwnerId
  getStore?: () => AssetStore | null
}) {
  const resolveStore = options.getStore ?? getAssetStore
  return async function postAssets(req: Request) {
    const owner = await options.resolveOwnerId(req)
    if (!owner.ok) return owner.response

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
    const normalizedContentType = contentType.toLowerCase()
    if (!ALLOWED_UPLOAD_CONTENT_TYPES.has(normalizedContentType)) {
      if (normalizedContentType === 'image/svg+xml') {
        return json({ error: '不支持上传 SVG 图片' }, { status: 415 })
      }
      return json({ error: '仅支持上传图片（jpeg/png/webp/gif/avif）' }, { status: 415 })
    }

    const arrayBuffer = await (file as File).arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)
    const maxBytes = resolveMaxBytes()
    if (bytes.byteLength > maxBytes) {
      return json({ error: '文件过大' }, { status: 413 })
    }

    const filename = typeof (file as any).name === 'string' && (file as any).name.trim() ? String((file as any).name).trim() : null

    // 归一化：Images 绑定可用且可归一化（非 GIF/AVIF）→ 1600 宽 WebP；
    // 绑定不可用（本地 dev）或转换失败 → 原样存
    const images = getImagesBinding()
    let storedBytes: Uint8Array = bytes
    let storedContentType = contentType
    let width: number | null = null
    let height: number | null = null
    if (images && shouldNormalizeForStorage(normalizedContentType)) {
      const normalized = await normalizeImageForStorage(images, bytes)
      if (normalized) {
        storedBytes = normalized.bytes
        storedContentType = normalized.contentType
        width = normalized.width
        height = normalized.height
      }
    }

    // R2 可用：先写对象（id 提前生成），DB 一次落库；R2 失败回落纯 bytes 路径
    const store = resolveStore()
    let id: string | undefined
    let storageKey: string | null = null
    if (store) {
      const generated = crypto.randomUUID()
      const key = `originals/${generated}`
      try {
        await store.putOriginal(key, storedBytes, storedContentType)
        id = generated
        storageKey = key
      } catch (error) {
        console.error('[asset.upload.r2_put_failed]', {
          event: 'asset_upload_r2_put_failed',
          error: error instanceof Error
            ? { name: error.name, message: error.message }
            : { message: String(error) },
        })
      }
    }

    const created = await options.assetRepo.create({
      ...(id ? { id } : {}),
      ownerId: owner.ownerId,
      contentType: storedContentType,
      filename,
      bytes: storedBytes,
      storageKey,
      byteLength: storedBytes.byteLength,
      width,
      height,
    })

    return json({ id: created.id, url: `/assets/${created.id}` })
  }
}

export function createGetAssetHandler(options: {
  assetRepo: AssetRepo
  getStore?: () => AssetStore | null
}) {
  const resolveStore = options.getStore ?? getAssetStore
  return async function getAsset(_req: Request, ctx: { params?: Promise<Record<string, string | string[] | undefined>> }) {
    const params = (await ctx.params) ?? {}
    const id = normalizeParam(params.id)
    if (!id) return new Response('Not found', { status: 404 })

    const requestUrl = (() => {
      try {
        return new URL(_req.url)
      } catch {
        return null
      }
    })()
    const runtimeCache = requestUrl ? getRuntimeCache() : null

    if (runtimeCache && requestUrl) {
      const cached = await runtimeCache.match(requestUrl.toString()).catch(() => null)
      if (cached) return cached
    }

    const variant = requestUrl ? parseImageVariantRequest(requestUrl) : null
    const hasVariant = Boolean(variant)
    const asset = await options.assetRepo.findById(id)
    if (!asset) return new Response('Not found', { status: 404 })

    const store = resolveStore()
    const headers = new Headers()
    headers.set('x-content-type-options', 'nosniff')

    // Defense-in-depth: legacy SVG uploads can execute scripts when served inline on the same origin.
    // We no longer allow uploading SVG, but we still harden serving.
    if (isSvgContentType(asset.contentType)) {
      const bytes = await loadOriginalBytes(asset, store, options.assetRepo)
      if (!bytes) return new Response('Not found', { status: 404 })
      headers.set('content-type', 'application/octet-stream')
      headers.set('content-disposition', `attachment; filename="${sanitizeFilename(asset.filename, `${id}.svg`)}"`)
      headers.set('cache-control', hasVariant ? 'no-store' : 'public, max-age=31536000, immutable')
      return new Response(toArrayBuffer(bytes), { status: 200, headers })
    }

    const isImage = (asset.contentType || '').startsWith('image/')
    const canTransform = isImage && !isSvgContentType(asset.contentType) && !isGifContentType(asset.contentType)

    if (hasVariant && canTransform) {
      // 先查 R2 变体缓存：命中直接流式返回，不碰原图，不占并发闸门
      if (store) {
        const hit = await store.getVariant(id, variant!.width, variant!.quality).catch(() => null)
        if (hit) {
          headers.set('content-type', 'image/webp')
          headers.set('cache-control', 'public, max-age=31536000, immutable')
          const response = new Response(hit.body, { status: 200, headers })
          if (runtimeCache && requestUrl) {
            await putRuntimeCache(runtimeCache, requestUrl.toString(), response)
          }
          return response
        }
      }

      // 未命中：读原图（R2 流或 bytes 回落）并转换；受并发闸门限制
      const release = await acquireTransformSlot()
      try {
        const source = await openOriginal(asset, store, options.assetRepo)
        if (!source) return new Response('Not found', { status: 404 })
        const rendered = await renderWebpVariant(source, variant!)

        if (store) {
          await runBackground(
            store.putVariant(id, variant!.width, variant!.quality, rendered),
          )
        }
        headers.set('content-type', 'image/webp')
        headers.set('cache-control', 'public, max-age=31536000, immutable')
        const response = new Response(toArrayBuffer(rendered), { status: 200, headers })
        if (runtimeCache && requestUrl) {
          await putRuntimeCache(runtimeCache, requestUrl.toString(), response)
        }
        return response
      } catch (error) {
        logVariantTransformError({ id, contentType: asset.contentType, variant: variant!, error })
        const fallback = await loadOriginalBytes(asset, store, options.assetRepo)
        headers.set('content-type', asset.contentType || 'application/octet-stream')
        headers.set('cache-control', 'no-store')
        return new Response(fallback ? toArrayBuffer(fallback) : new ArrayBuffer(0), {
          status: fallback ? 200 : 404,
          headers,
        })
      } finally {
        release()
      }
    }

    // 无变体（或不可转换）：优先 R2 原图流，否则 bytes 回落
    if (store && asset.storageKey) {
      const original = await store.getOriginal(asset.storageKey).catch(() => null)
      if (original) {
        headers.set('content-type', original.contentType || asset.contentType || 'application/octet-stream')
        headers.set('cache-control', hasVariant ? 'no-store' : 'public, max-age=31536000, immutable')
        const response = new Response(original.body, { status: 200, headers })
        if (!hasVariant && runtimeCache && requestUrl) {
          await putRuntimeCache(runtimeCache, requestUrl.toString(), response)
        }
        return response
      }
    }

    const bytes = await options.assetRepo.findBytesById(id)
    if (!bytes) return new Response('Not found', { status: 404 })
    headers.set('content-type', asset.contentType || 'application/octet-stream')
    headers.set('cache-control', hasVariant ? 'no-store' : 'public, max-age=31536000, immutable')
    const response = new Response(toArrayBuffer(bytes), { status: 200, headers })
    if (!hasVariant && runtimeCache && requestUrl) {
      await putRuntimeCache(runtimeCache, requestUrl.toString(), response)
    }
    return response
  }
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

async function renderWebpVariant(
  source: OriginalSource,
  variant: { width: number; quality: number },
): Promise<Uint8Array> {
  const images = getImagesBinding()
  if (images) {
    const stream = 'stream' in source ? source.stream : uint8ArrayToStream(source.bytes)
    const result = await images
      .input(stream)
      .transform({ width: variant.width, fit: 'scale-down' })
      .output({ format: 'image/webp', quality: variant.quality })
    return new Uint8Array(await result.response().arrayBuffer())
  }

  // 本地 dev 回落 sharp：Buffer.from(arrayBuffer, offset, length) 是零拷贝视图
  const input = 'bytes' in source
    ? source.bytes
    : await streamToUint8Array(source.stream)
  const { default: sharp } = await import('sharp')
  const out = await sharp(Buffer.from(input.buffer, input.byteOffset, input.byteLength), { failOnError: false })
    .rotate()
    .resize({ width: variant.width, withoutEnlargement: true })
    .webp({ quality: variant.quality })
    .toBuffer()
  return new Uint8Array(out)
}

function logVariantTransformError(input: {
  id: string
  contentType: string
  variant: { width: number; quality: number }
  error: unknown
}) {
  const error = input.error instanceof Error
    ? { name: input.error.name, message: input.error.message, stack: input.error.stack }
    : { message: String(input.error) }
  console.error('[asset.variant.transform_failed]', {
    event: 'asset_image_variant_transform_failed',
    assetId: input.id,
    contentType: input.contentType,
    width: input.variant.width,
    quality: input.variant.quality,
    error,
  })
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
