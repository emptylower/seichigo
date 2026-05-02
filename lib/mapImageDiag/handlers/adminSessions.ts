import { NextResponse } from 'next/server'
import type { MapImageDiagApiDeps } from '@/lib/mapImageDiag/api'
import {
  deleteMapImageDiagSession,
  ensureAdminMapImageDiagSession,
  getMapImageDiagControl,
  getMapImageDiagSessionDetail,
  listMapImageDiagSessions,
  purgeMapImageDiagSessions,
  setMapImageDiagControl,
  summarizeMapImageDiagRange,
} from '@/lib/mapImageDiag/service'

function parseLimit(input: string | null): number {
  const raw = Number(input)
  if (!Number.isFinite(raw)) return 20
  return Math.max(1, Math.min(100, Math.floor(raw)))
}

function parseCursorDate(input: string | null): Date | null {
  const text = String(input || '').trim()
  if (!text) return null
  const date = new Date(text)
  return Number.isFinite(date.getTime()) ? date : null
}

function parseDateInput(input: string | null): Date | null {
  const text = String(input || '').trim()
  if (!text) return null
  const date = new Date(text)
  return Number.isFinite(date.getTime()) ? date : null
}

function isSchemaMissingError(error: unknown): boolean {
  const code = (error as any)?.code
  return code === 'P2021' || code === 'P2022'
}

function resolveRange(url: URL, now = new Date()): {
  start: Date
  end: Date
  preset: '1h' | '6h' | '24h' | '7d' | 'custom'
} {
  const presetRaw = String(url.searchParams.get('preset') || '').trim()
  const start = parseDateInput(url.searchParams.get('start'))
  const end = parseDateInput(url.searchParams.get('end')) || now

  if (start && end && start.getTime() < end.getTime()) {
    return { start, end, preset: 'custom' }
  }

  const preset = presetRaw === '1h' || presetRaw === '6h' || presetRaw === '7d' ? presetRaw : '24h'
  const durationMs = preset === '1h'
    ? 60 * 60 * 1000
    : preset === '6h'
      ? 6 * 60 * 60 * 1000
      : preset === '7d'
        ? 7 * 24 * 60 * 60 * 1000
        : 24 * 60 * 60 * 1000

  return {
    start: new Date(end.getTime() - durationMs),
    end,
    preset,
  }
}

async function parseJsonBody(req: Request): Promise<unknown> {
  return req.json().catch(() => null)
}

export function createHandlers(deps: MapImageDiagApiDeps) {
  return {
    async GET(req: Request) {
      try {
        await ensureAdminMapImageDiagSession(deps)
        const url = new URL(req.url)
        const range = resolveRange(url, deps.now())
        const result = await listMapImageDiagSessions(deps, {
          limit: parseLimit(url.searchParams.get('limit')),
          cursor: parseCursorDate(url.searchParams.get('cursor')),
          start: range.start,
          end: range.end,
        })
        return NextResponse.json({ ok: true, ...result })
      } catch (error) {
        if (error instanceof Error && error.message === 'Unauthorized') {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        if (isSchemaMissingError(error)) {
          return NextResponse.json({
            ok: true,
            items: [],
            nextCursor: null,
            warning: '地图图片诊断数据库结构未更新，暂时无法读取会话数据。',
          })
        }
        console.error('[map-image-diagnostics/admin] GET failed', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }
    },

    async GET_BY_ID(_req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
      try {
        await ensureAdminMapImageDiagSession(deps)
        const { sessionId } = await ctx.params
        const result = await getMapImageDiagSessionDetail(deps, String(sessionId || '').trim())
        if (!result) {
          return NextResponse.json({ error: 'Session not found' }, { status: 404 })
        }
        return NextResponse.json({ ok: true, ...result })
      } catch (error) {
        if (error instanceof Error && error.message === 'Unauthorized') {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        if (isSchemaMissingError(error)) {
          return NextResponse.json({ error: '地图图片诊断数据库结构未更新，请先执行迁移后再查看详情。' }, { status: 503 })
        }
        console.error('[map-image-diagnostics/admin] GET_BY_ID failed', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }
    },

    async GET_OVERVIEW(req: Request) {
      try {
        await ensureAdminMapImageDiagSession(deps)
        const url = new URL(req.url)
        const range = resolveRange(url, deps.now())
        const result = await summarizeMapImageDiagRange(deps, {
          start: range.start,
          end: range.end,
        })
        return NextResponse.json({
          ok: true,
          range: {
            preset: range.preset,
            start: range.start.toISOString(),
            end: range.end.toISOString(),
          },
          ...result,
        })
      } catch (error) {
        if (error instanceof Error && error.message === 'Unauthorized') {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        if (isSchemaMissingError(error)) {
          const range = resolveRange(new URL(req.url), deps.now())
          return NextResponse.json({
            ok: true,
            range: {
              preset: range.preset,
              start: range.start.toISOString(),
              end: range.end.toISOString(),
            },
            warning: '地图图片诊断数据库结构未更新，暂时无法生成总览。',
            totals: {
              sessions: 0,
              degradedSessions: 0,
              failureSessions: 0,
              fallbackSessions: 0,
              proxySessions: 0,
              sampledSessions: 0,
              avgDurationMs: null,
              p95DurationMs: null,
            },
            durationBuckets: [],
            outcomes: [],
            stageStats: [],
            timeline: [],
            recentSessions: [],
          })
        }
        console.error('[map-image-diagnostics/admin] GET_OVERVIEW failed', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }
    },

    async GET_CONFIG() {
      try {
        await ensureAdminMapImageDiagSession(deps)
        const config = await getMapImageDiagControl(deps)
        return NextResponse.json({ ok: true, config })
      } catch (error) {
        if (error instanceof Error && error.message === 'Unauthorized') {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        if (isSchemaMissingError(error)) {
          return NextResponse.json({
            ok: true,
            config: {
              fullCaptureEnabled: false,
              updatedAt: null,
            },
            warning: '数据库结构未更新，当前仅支持本浏览器临时全量扫描。',
          })
        }
        console.error('[map-image-diagnostics/admin] GET_CONFIG failed', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }
    },

    async PUT_CONFIG(req: Request) {
      const body = await parseJsonBody(req) as { fullCaptureEnabled?: unknown } | null
      const fullCaptureEnabled = Boolean(body?.fullCaptureEnabled)
      try {
        await ensureAdminMapImageDiagSession(deps)
        const config = await setMapImageDiagControl(deps, { fullCaptureEnabled })
        return NextResponse.json({ ok: true, config })
      } catch (error) {
        if (error instanceof Error && error.message === 'Unauthorized') {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        if (isSchemaMissingError(error)) {
          return NextResponse.json({
            ok: true,
            config: {
              fullCaptureEnabled,
              updatedAt: null,
            },
            warning: '数据库结构未更新，已切换为本浏览器临时全量扫描。',
          })
        }
        console.error('[map-image-diagnostics/admin] PUT_CONFIG failed', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }
    },

    async DELETE_BY_ID(_req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
      try {
        await ensureAdminMapImageDiagSession(deps)
        const { sessionId } = await ctx.params
        const deleted = await deleteMapImageDiagSession(deps, String(sessionId || '').trim())
        if (!deleted) {
          return NextResponse.json({ error: 'Session not found' }, { status: 404 })
        }
        return NextResponse.json({ ok: true })
      } catch (error) {
        if (error instanceof Error && error.message === 'Unauthorized') {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        console.error('[map-image-diagnostics/admin] DELETE_BY_ID failed', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }
    },

    async PURGE(req: Request) {
      try {
        await ensureAdminMapImageDiagSession(deps)
        const body = await parseJsonBody(req) as { start?: string | null; end?: string | null } | null
        const start = parseDateInput(body?.start ?? null)
        const end = parseDateInput(body?.end ?? null)
        const result = await purgeMapImageDiagSessions(deps, { start, end })
        return NextResponse.json({ ok: true, deletedCount: result.count })
      } catch (error) {
        if (error instanceof Error && error.message === 'Unauthorized') {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        console.error('[map-image-diagnostics/admin] PURGE failed', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }
    },
  }
}
