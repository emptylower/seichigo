export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { inferKeywordCategory, inferKeywordLanguage } from '@/lib/seo/keywords/infer'

const prioritySchema = z.preprocess((v) => {
  if (typeof v === 'string' && v.trim()) return Number.parseInt(v, 10)
  return v
}, z.number().int().min(0).max(999))

const createSchema = z.object({
  keyword: z.string().trim().min(1).max(100),
  language: z.enum(['zh', 'en', 'ja']).optional(),
  category: z.enum(['short-tail', 'long-tail']).optional(),
  priority: prioritySchema.optional().default(0),
  isActive: z.boolean().optional(),
})

export async function POST(request: Request) {
  const session = await getServerAuthSession()
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const json = await request.json()
    const input = createSchema.parse(json)

    const language = input.language ?? inferKeywordLanguage(input.keyword)
    const category = input.category ?? inferKeywordCategory(input.keyword, language)

    const existing = await prisma.seoKeyword.findFirst({
      where: { keyword: input.keyword, language },
      select: { id: true },
    })

    const keyword = existing
      ? await prisma.seoKeyword.update({
          where: { id: existing.id },
          data: {
            category,
            priority: input.priority,
            isActive: input.isActive ?? true,
          },
        })
      : await prisma.seoKeyword.create({
          data: {
            keyword: input.keyword,
            language,
            category,
            priority: input.priority,
            isActive: input.isActive ?? true,
          },
        })

    return NextResponse.json({ keyword })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'Invalid input' }, { status: 400 })
    }
    console.error('[api/admin/seo/keywords] POST failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Create failed' },
      { status: 500 }
    )
  }
}
