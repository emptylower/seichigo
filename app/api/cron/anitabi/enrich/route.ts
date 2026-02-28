export const runtime = 'nodejs'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { enrichBatch } from '@/lib/anitabi/enrichment/workflow'

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

function toFloat(value: string | null | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseFloat(String(value || '').trim())
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

export async function POST(req: Request) {
  try {
    const expectedSecret = String(
      process.env.ANITABI_CRON_SECRET || process.env.OPS_CRON_SECRET || process.env.CRON_SECRET || '',
    ).trim()

    if (!expectedSecret) {
      return NextResponse.json({ error: 'ANITABI cron secret is not configured' }, { status: 503 })
    }

    const providedSecret = extractProvidedSecret(req)
    if (!providedSecret || providedSecret !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(req.url)
    const limit = toInt(url.searchParams.get('limit'), 100, 1, 1000)
    const concurrency = toInt(url.searchParams.get('concurrency'), 2, 1, 8)
    const minConfidence = toFloat(url.searchParams.get('minConfidence'), 0.5, 0, 1)

    const result = await enrichBatch(prisma, { limit, concurrency, minConfidence })

    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[api/cron/anitabi/enrich] POST failed', err)

    const code = (err as { code?: string }).code
    if (code === 'P2021' || code === 'P2022') {
      return NextResponse.json(
        { error: '数据库结构未更新，请先执行迁移（prisma migrate deploy）后重试' },
        { status: 503 },
      )
    }

    const msg = String((err as { message?: string }).message || '')
    if (msg.includes('Environment variable not found') && msg.includes('DATABASE_URL')) {
      return NextResponse.json({ error: '数据库未配置' }, { status: 503 })
    }

    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 })
  }
}
