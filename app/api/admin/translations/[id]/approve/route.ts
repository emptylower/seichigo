import { NextRequest, NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerAuthSession()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const task = await prisma.translationTask.findUnique({
      where: { id },
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    if (!task.draftContent) {
      return NextResponse.json(
        { error: 'No draft content to approve' },
        { status: 400 }
      )
    }

    const { entityType, entityId, targetLanguage, draftContent } = task

    if (entityType === 'article') {
      const existingArticle = await prisma.article.findFirst({
        where: {
          translationGroupId: entityId,
          language: targetLanguage,
        },
      })

      if (existingArticle) {
        await prisma.article.update({
          where: { id: existingArticle.id },
          data: draftContent as any,
        })
      } else {
        const sourceArticle = await prisma.article.findUnique({
          where: { id: entityId },
        })

        if (sourceArticle) {
          const draftData = draftContent as Record<string, any>
          await prisma.article.create({
            data: {
              ...draftData,
              authorId: sourceArticle.authorId,
              language: targetLanguage,
              translationGroupId: sourceArticle.translationGroupId || sourceArticle.id,
              status: 'published',
            } as any,
          })
        }
      }
    } else if (entityType === 'city') {
      const updateData: any = {}
      const content = draftContent as any

      if (targetLanguage === 'en') {
        if (content.name) updateData.name_en = content.name
        if (content.description) updateData.description_en = content.description
        if (content.transportTips) updateData.transportTips_en = content.transportTips
      } else if (targetLanguage === 'ja') {
        if (content.name) updateData.name_ja = content.name
        if (content.description) updateData.description_ja = content.description
      }

      await prisma.city.update({
        where: { id: entityId },
        data: updateData,
      })
    } else if (entityType === 'anime') {
      const updateData: any = {}
      const content = draftContent as any

      if (targetLanguage === 'en') {
        if (content.name) updateData.name_en = content.name
        if (content.summary) updateData.summary_en = content.summary
      } else if (targetLanguage === 'ja') {
        if (content.name) updateData.name_ja = content.name
        if (content.summary) updateData.summary_ja = content.summary
      }

      await prisma.anime.update({
        where: { id: entityId },
        data: updateData,
      })
    }

    await prisma.translationTask.update({
      where: { id },
      data: {
        status: 'approved',
        finalContent: draftContent,
        updatedAt: new Date(),
      },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[api/admin/translations/[id]/approve] POST failed', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
