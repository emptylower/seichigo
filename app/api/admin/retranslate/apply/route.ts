import { NextRequest, NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { z } from 'zod'

const applySchema = z.object({
  entityType: z.enum(['anime', 'city', 'article']),
  entityId: z.string().min(1),
  targetLang: z.enum(['en', 'ja']),
  preview: z.record(z.any()),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = await req.json().catch(() => null)
    const parsed = applySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Invalid parameters' },
        { status: 400 }
      )
    }

    const { entityType, entityId, targetLang, preview } = parsed.data

    let updated
    if (entityType === 'article') {
      const updateData: any = {}
      if ('title' in preview) updateData.title = preview.title
      if ('description' in preview) updateData.description = preview.description
      if ('seoTitle' in preview) updateData.seoTitle = preview.seoTitle
      if ('contentJson' in preview) updateData.contentJson = preview.contentJson

      updated = await prisma.article.update({
        where: { id: entityId },
        data: updateData,
      })
    } else if (entityType === 'city') {
      const updateData: any = {}
      if (targetLang === 'en') {
        if ('name' in preview) updateData.name_en = preview.name
        if ('description' in preview) updateData.description_en = preview.description
        if ('transportTips' in preview) updateData.transportTips_en = preview.transportTips
      } else if (targetLang === 'ja') {
        if ('name' in preview) updateData.name_ja = preview.name
        if ('description' in preview) updateData.description_ja = preview.description
        if ('transportTips' in preview) updateData.transportTips_ja = preview.transportTips
      }

      updated = await prisma.city.update({
        where: { id: entityId },
        data: updateData,
      })
    } else if (entityType === 'anime') {
      const updateData: any = {}
      if ('name' in preview) updateData.name = preview.name
      if ('summary' in preview) updateData.summary = preview.summary

      updated = await prisma.anime.update({
        where: { id: entityId },
        data: updateData,
      })
    } else {
      return NextResponse.json(
        { error: 'Unknown entity type' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      ok: true,
      updated,
    })
  } catch (error) {
    console.error('[api/admin/retranslate/apply] POST failed', error)
    
    const msg = String((error as { message?: unknown } | null)?.message || '')
    if (msg.includes('Record to update not found')) {
      return NextResponse.json(
        { error: 'Entity not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
