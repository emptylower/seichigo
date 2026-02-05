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

const patchSchema = z.object({
  keyword: z.string().trim().min(1).max(100).optional(),
  language: z.enum(['zh', 'en', 'ja']).optional(),
  category: z.enum(['short-tail', 'long-tail']).optional(),
  priority: prioritySchema.optional(),
  isActive: z.boolean().optional(),
})

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getServerAuthSession()
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { id } = await ctx.params
    const json = await request.json()
    const parsed = patchSchema.parse(json)

    const input = (() => {
      if (!parsed.keyword) return parsed
      const language = parsed.language ?? inferKeywordLanguage(parsed.keyword)
      const category = parsed.category ?? inferKeywordCategory(parsed.keyword, language)
      return { ...parsed, language, category }
    })()

    if (Object.keys(input).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const updated = await prisma.seoKeyword.update({
      where: { id },
      data: input,
    })

    return NextResponse.json({ keyword: updated })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'Invalid input' }, { status: 400 })
    }
    console.error('[api/admin/seo/keywords/[id]] PATCH failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Update failed' },
      { status: 500 }
    )
  }
}
