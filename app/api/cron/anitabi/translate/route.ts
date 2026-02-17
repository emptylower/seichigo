export const runtime = 'nodejs'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getAnitabiApiDeps } from '@/lib/anitabi/api'
import { executeMapTranslationTasks } from '@/lib/translation/mapTaskExecutor'

function parseBearerToken(raw: string | null): string | null {
  const text = String(raw || '').trim()
  if (!text) return null
  const match = /^bearer\s+(.+)$/i.exec(text)
  if (!match) return null
  const token = String(match[1] || '').trim()
  return token || null
}

function extractProvidedSecret(req: Request): string | null {
  const auth = parseBearerToken(req.headers.get('authorization'))
  if (auth) return auth

  const header = String(req.headers.get('x-anitabi-cron-secret') || '').trim()
  if (header) return header

  const url = new URL(req.url)
  const query = String(url.searchParams.get('secret') || '').trim()
  return query || null
}

function toInt(value: string | null | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value || '').trim(), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

export async function GET(req: Request) {
  try {
    const deps = await getAnitabiApiDeps()

    const expectedSecret = deps.getCronSecret()
    if (!expectedSecret) {
      return NextResponse.json({ error: 'ANITABI cron secret is not configured' }, { status: 503 })
    }

    const providedSecret = extractProvidedSecret(req)
    if (!providedSecret || providedSecret !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(req.url)
    const limit = toInt(url.searchParams.get('limit'), 300, 1, 1000)
    const concurrency = toInt(url.searchParams.get('concurrency'), 4, 1, 12)
    const includeFailed = url.searchParams.get('includeFailed') === '1'

    const candidates = await deps.prisma.translationTask.findMany({
      where: {
        entityType: { in: ['anitabi_bangumi', 'anitabi_point'] },
        status: { in: includeFailed ? ['pending', 'failed'] : ['pending'] },
        targetLanguage: { in: ['en', 'ja'] },
      },
      orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
      select: {
        id: true,
      },
    })

    const candidateIds = candidates.map((row) => row.id)
    if (candidateIds.length === 0) {
      return NextResponse.json({
        ok: true,
        claimed: 0,
        processed: 0,
        success: 0,
        failed: 0,
        skipped: 0,
        results: [],
      })
    }

    await deps.prisma.translationTask.updateMany({
      where: {
        id: { in: candidateIds },
        status: { in: includeFailed ? ['pending', 'failed'] : ['pending'] },
      },
      data: {
        status: 'processing',
        error: null,
        updatedAt: new Date(),
      },
    })

    const claimedTasks = await deps.prisma.translationTask.findMany({
      where: {
        id: { in: candidateIds },
        status: 'processing',
        entityType: { in: ['anitabi_bangumi', 'anitabi_point'] },
      },
      orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        entityType: true,
        entityId: true,
        targetLanguage: true,
      },
    })

    if (claimedTasks.length === 0) {
      return NextResponse.json({
        ok: true,
        claimed: 0,
        processed: 0,
        success: 0,
        failed: 0,
        skipped: candidateIds.length,
        results: [],
      })
    }

    const results = await executeMapTranslationTasks({
      prisma: deps.prisma,
      tasks: claimedTasks,
      concurrency,
    })

    const success = results.filter((row) => row.status === 'ready').length
    const failed = results.filter((row) => row.status === 'failed').length

    return NextResponse.json({
      ok: true,
      claimed: claimedTasks.length,
      processed: success + failed,
      success,
      failed,
      skipped: candidateIds.length - claimedTasks.length,
      results,
    })
  } catch (err) {
    console.error('[api/cron/anitabi/translate] GET failed', err)

    const code = (err as any)?.code
    if (code === 'P2021' || code === 'P2022') {
      return NextResponse.json({ error: '数据库结构未更新，请先执行迁移（prisma migrate deploy）后重试' }, { status: 503 })
    }

    const msg = String((err as any)?.message || '')
    if (msg.includes('Environment variable not found') && msg.includes('DATABASE_URL')) {
      return NextResponse.json({ error: '数据库未配置' }, { status: 503 })
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
