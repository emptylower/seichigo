import { NextResponse } from 'next/server'
import type { RouteBookApiDeps } from '@/lib/routeBook/api'
import type { RouteBookDetail } from '@/lib/routeBook/repo'
import { buildGpx, type GpxExportScope, type GpxPointPreview } from '@/lib/routeBook/exportGpx'
import { buildIcs } from '@/lib/routeBook/exportIcs'
import { routeBookErrorResponse } from './errors'

/**
 * GET /api/me/routebooks/[id]/export.gpx?scope=all|day&dayIndex=N → application/gpx+xml 附件
 * GET /api/me/routebooks/[id]/export.ics → text/calendar 附件；无日期行程 → 400
 */

/** RFC 5987：encodeURIComponent 之外再编码 `'()*!`（attr-char 不允许）；标题为空用 routebook */
function encodeFilenameValue(value: string): string {
  return encodeURIComponent(value).replace(/['()*!]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
}

function contentDisposition(title: string, ext: 'gpx' | 'ics'): string {
  const name = title.trim() || 'routebook'
  return `attachment; filename="routebook.${ext}"; filename*=UTF-8''${encodeFilenameValue(name)}.${ext}`
}

type ResolvedBook =
  | { ok: false; error: NextResponse }
  | { ok: true; detail: RouteBookDetail }

export function createExportHandlers(deps: RouteBookApiDeps) {
  /** 点位预览（名 + 坐标）：有坐标才进 Map（GPX/日历名共用；无坐标点位不导出） */
  async function buildPreviews(pointIds: string[]): Promise<Map<string, GpxPointPreview>> {
    const unique = [...new Set(pointIds)]
    const [coords, names] = await Promise.all([
      deps.pointCoords(unique),
      deps.pointNames ? deps.pointNames(unique) : Promise.resolve(new Map<string, string>()),
    ])
    const previews = new Map<string, GpxPointPreview>()
    for (const [pointId, { lat, lng }] of coords) {
      previews.set(pointId, { title: names.get(pointId) ?? `点位 ${pointId.slice(0, 8)}`, lat, lng })
    }
    return previews
  }

  async function resolveBook(userId: string, routeBookId: string): Promise<ResolvedBook> {
    const detail = await deps.repo.getById(routeBookId, userId)
    if (!detail) {
      return { ok: false, error: NextResponse.json({ error: '行程不存在', reason: 'not_found' }, { status: 404 }) }
    }
    return { ok: true, detail }
  }

  return {
    async GET_gpx(req: Request, ctx: { params: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

      const { id } = await ctx.params
      const resolved = await resolveBook(userId, id)
      if (!resolved.ok) return resolved.error
      const { detail } = resolved

      const url = new URL(req.url)
      const scopeRaw = url.searchParams.get('scope') ?? 'all'
      let scope: GpxExportScope
      if (scopeRaw === 'all') {
        scope = { kind: 'all' }
      } else if (scopeRaw === 'day') {
        const dayIndex = Number(url.searchParams.get('dayIndex'))
        if (!Number.isInteger(dayIndex) || !detail.days.some((day) => day.dayIndex === dayIndex)) {
          return NextResponse.json({ error: 'dayIndex 参数错误：该天不存在' }, { status: 400 })
        }
        scope = { kind: 'day', dayIndex }
      } else {
        return NextResponse.json({ error: 'scope 参数应为 all 或 day' }, { status: 400 })
      }

      try {
        const pointIds = detail.items.flatMap((item) => (item.kind === 'point' && item.pointId ? [item.pointId] : []))
        const previews = await buildPreviews(pointIds)
        const gpx = buildGpx({
          title: detail.title,
          days: detail.days,
          items: detail.items,
          places: detail.places,
          lodgings: detail.lodgings,
          previews,
          scope,
        })
        return new NextResponse(gpx, {
          headers: {
            'Content-Type': 'application/gpx+xml; charset=utf-8',
            'Content-Disposition': contentDisposition(detail.title, 'gpx'),
          },
        })
      } catch (err) {
        return routeBookErrorResponse(err)
      }
    },

    async GET_ics(_req: Request, ctx: { params: Promise<{ id: string }> }) {
      const session = await deps.getSession()
      const userId = session?.user?.id
      if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 })

      const { id } = await ctx.params
      const resolved = await resolveBook(userId, id)
      if (!resolved.ok) return resolved.error
      const { detail } = resolved

      if (!detail.days.some((day) => day.date !== null)) {
        return NextResponse.json({ error: '行程没有日期，无法导出日历' }, { status: 400 })
      }

      try {
        const pointIds = detail.items.flatMap((item) => (item.kind === 'point' && item.pointId ? [item.pointId] : []))
        const previews = await buildPreviews(pointIds)
        const ics = buildIcs({
          title: detail.title,
          days: detail.days,
          items: detail.items,
          places: detail.places,
          previews,
          now: deps.now(),
        })
        return new NextResponse(ics, {
          headers: {
            'Content-Type': 'text/calendar; charset=utf-8',
            'Content-Disposition': contentDisposition(detail.title, 'ics'),
          },
        })
      } catch (err) {
        return routeBookErrorResponse(err)
      }
    },
  }
}
