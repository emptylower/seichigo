export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { inferKeywordCategory, inferKeywordLanguage } from '@/lib/seo/keywords/infer'

const bulkSchema = z.object({
  input: z.string().trim().min(1).max(50_000),
  isActive: z.boolean().optional(),
})

const rowSchema = z.object({
  keyword: z.string().trim().min(1).max(100),
  language: z.enum(['zh', 'en', 'ja']),
  category: z.enum(['short-tail', 'long-tail']),
  priority: z.number().int().min(0).max(999),
  isActive: z.boolean(),
})

type RowInput = {
  line: number
  raw: string
  keyword: string
  priority?: number
  language?: 'zh' | 'en' | 'ja'
}

function parsePriority(raw: string | undefined): number | null {
  if (!raw) return null
  const value = Number.parseInt(raw.trim(), 10)
  if (!Number.isFinite(value)) return null
  return value
}

function parseBulkInput(text: string): { rows: RowInput[]; errors: Array<{ line: number; raw: string; reason: string }> } {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')

  const rows: RowInput[] = []
  const errors: Array<{ line: number; raw: string; reason: string }> = []

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] || ''
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('#')) continue

    const safeLine = line.replace(/，/g, ',')

    const parts = safeLine.split(',').map((p) => p.trim()).filter(Boolean)

    if (parts.length >= 2) {
      const keyword = parts[0] || ''
      const priority = parsePriority(parts[1])
      const language = parts[2] as RowInput['language'] | undefined

      if (!keyword.trim()) {
        errors.push({ line: i + 1, raw: rawLine, reason: 'Missing keyword' })
        continue
      }

      rows.push({
        line: i + 1,
        raw: rawLine,
        keyword,
        priority: priority ?? undefined,
        language: language && ['zh', 'en', 'ja'].includes(language) ? language : undefined,
      })
      continue
    }

    const maybeTrailingNumber = safeLine.match(/^(.*?)[\t ]+(\d{1,4})$/)
    if (maybeTrailingNumber) {
      const keyword = maybeTrailingNumber[1]?.trim() || ''
      const priority = parsePriority(maybeTrailingNumber[2])
      if (!keyword) {
        errors.push({ line: i + 1, raw: rawLine, reason: 'Missing keyword' })
        continue
      }
      rows.push({ line: i + 1, raw: rawLine, keyword, priority: priority ?? undefined })
      continue
    }

    rows.push({ line: i + 1, raw: rawLine, keyword: safeLine })
  }

  return { rows, errors }
}

export async function POST(request: Request) {
  const session = await getServerAuthSession()
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const json = await request.json()
    const input = bulkSchema.parse(json)

    const parsed = parseBulkInput(input.input)
    const isActive = input.isActive ?? true

    const deduped = new Map<string, z.infer<typeof rowSchema>>()
    const errors = [...parsed.errors]

    for (const row of parsed.rows) {
      const language = row.language ?? inferKeywordLanguage(row.keyword)
      const category = inferKeywordCategory(row.keyword, language)
      const priority = typeof row.priority === 'number' ? row.priority : 0

      const validated = rowSchema.safeParse({
        keyword: row.keyword,
        language,
        category,
        priority,
        isActive,
      })

      if (!validated.success) {
        errors.push({
          line: row.line,
          raw: row.raw,
          reason: validated.error.issues[0]?.message || 'Invalid row',
        })
        continue
      }

      const key = `${validated.data.keyword}||${validated.data.language}`
      deduped.set(key, validated.data)
    }

    let inserted = 0
    let updated = 0

    for (const row of deduped.values()) {
      const existing = await prisma.seoKeyword.findFirst({
        where: { keyword: row.keyword, language: row.language },
        select: { id: true },
      })

      if (existing) {
        await prisma.seoKeyword.update({
          where: { id: existing.id },
          data: {
            category: row.category,
            priority: row.priority,
            isActive: row.isActive,
          },
        })
        updated++
      } else {
        await prisma.seoKeyword.create({
          data: row,
        })
        inserted++
      }
    }

    return NextResponse.json({
      inserted,
      updated,
      total: inserted + updated,
      errors,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'Invalid input' }, { status: 400 })
    }
    console.error('[api/admin/seo/keywords/bulk] POST failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Import failed' },
      { status: 500 }
    )
  }
}
