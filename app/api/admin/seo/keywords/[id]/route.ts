export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

const patchSchema = z.object({
  keyword: z.string().trim().min(1).max(100).optional(),
  language: z.enum(['zh', 'en', 'ja']).optional(),
  category: z.enum(['short-tail', 'long-tail']).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
})

export async function PATCH(request: Request, ctx: { params: { id: string } }) {
  const session = await getServerAuthSession()
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const id = ctx.params.id
    const json = await request.json()
    const input = patchSchema.parse(json)

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

