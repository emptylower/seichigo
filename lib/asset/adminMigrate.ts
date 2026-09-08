import type { AssetRepo } from './repo'
import { originalKey, getAssetStore } from './store'
import { isGifContentType, isSvgContentType, isAvifContentType, normalizeImageForStorage } from './normalize'
import { getCfBindings } from '@/lib/anitabi/cf/bindings'

/**
 * 2026-09-08 图片资产迁 R2：管理端存量迁移。
 * 逐条串行：读 bytes → 可归一化的图片（非 GIF/AVIF/SVG）经 Images 转 1600 宽
 * WebP → putOriginal → 只更新 storageKey/byteLength/width/height（不修改 bytes）。
 * 单条失败记录后继续；已有 storageKey 的跳过（幂等）。
 * POST /api/admin/assets/migrate?limit=10 → { migrated, remaining, failed }
 * GET  /api/admin/assets/migrate → { total, migrated, remaining }
 */

type SessionLike = { user?: { id?: string | null; isAdmin?: boolean } | null } | null

const MIGRATE_DEFAULT_LIMIT = 10
const MIGRATE_MAX_LIMIT = 50

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers)
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8')
  }
  return new Response(JSON.stringify(data), { ...init, headers })
}

function parseLimit(raw: string | null): number {
  if (!raw) return MIGRATE_DEFAULT_LIMIT
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return MIGRATE_DEFAULT_LIMIT
  return Math.min(parsed, MIGRATE_MAX_LIMIT)
}

export function createAdminAssetsMigrateHandlers(options: {
  assetRepo: AssetRepo
  getSession: () => Promise<SessionLike>
}) {
  async function requireAdmin(): Promise<Response | null> {
    const session = await options.getSession()
    if (!session?.user?.isAdmin) {
      return json({ error: 'Forbidden' }, { status: 403 })
    }
    return null
  }

  async function POST(req: Request) {
    const denied = await requireAdmin()
    if (denied) return denied

    const store = getAssetStore()
    if (!store) {
      return json({ error: 'R2 ASSET_STORE 绑定不可用（本地开发无法执行迁移）' }, { status: 503 })
    }

    const url = (() => {
      try {
        return new URL(req.url)
      } catch {
        return null
      }
    })()
    const limit = parseLimit(url?.searchParams.get('limit') ?? null)

    const ids = await options.assetRepo.listUnmigratedIds(limit)
    const images = getCfBindings()?.env?.IMAGES ?? null
    const failed: Array<{ id: string; error: string }> = []
    let migrated = 0

    for (const id of ids) {
      try {
        const asset = await options.assetRepo.findById(id)
        if (!asset) {
          failed.push({ id, error: 'asset not found' })
          continue
        }
        if (asset.storageKey) continue // 幂等：并发/重跑保护

        const bytes = await options.assetRepo.findBytesById(id)
        if (!bytes) {
          failed.push({ id, error: 'bytes missing' })
          continue
        }

        let storedBytes = bytes
        let storedContentType = asset.contentType
        let width: number | null = null
        let height: number | null = null
        const normalizable = !isGifContentType(asset.contentType)
          && !isAvifContentType(asset.contentType)
          && !isSvgContentType(asset.contentType)
        if (images && normalizable) {
          const normalized = await normalizeImageForStorage(images, bytes)
          if (normalized) {
            storedBytes = normalized.bytes
            storedContentType = normalized.contentType
            width = normalized.width
            height = normalized.height
          }
          // 归一化失败 → 原样迁移（bytes 列不动，回滚始终安全）
        }

        const storageKey = originalKey(id)
        await store.putOriginal(storageKey, storedBytes, storedContentType)
        await options.assetRepo.updateR2Fields(id, {
          storageKey,
          byteLength: storedBytes.byteLength,
          width,
          height,
        })
        migrated++
      } catch (error) {
        failed.push({
          id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const remaining = await options.assetRepo.countUnmigrated()
    return json({ migrated, remaining, failed })
  }

  async function GET() {
    const denied = await requireAdmin()
    if (denied) return denied

    const total = await options.assetRepo.countAll()
    const remaining = await options.assetRepo.countUnmigrated()
    return json({ total, migrated: total - remaining, remaining })
  }

  return { POST, GET }
}
