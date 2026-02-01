import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
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
          select: {
            id: true,
            authorId: true,
            slug: true,
            translationGroupId: true,
            cover: true,
            animeIds: true,
            city: true,
            routeLength: true,
            tags: true,
          },
        })

        if (sourceArticle) {
          const draftData = draftContent as Record<string, any>
          await prisma.article.create({
            data: {
              ...draftData,
              slug: draftData.slug || sourceArticle.slug,
              authorId: sourceArticle.authorId,
              language: targetLanguage,
              translationGroupId: sourceArticle.translationGroupId || sourceArticle.id,
              cover: sourceArticle.cover,
              animeIds: sourceArticle.animeIds,
              city: sourceArticle.city,
              routeLength: sourceArticle.routeLength,
              tags: sourceArticle.tags,
              status: 'published',
            } as any,
          })

          if (!sourceArticle.translationGroupId) {
            await prisma.article.update({
              where: { id: sourceArticle.id },
              data: { translationGroupId: sourceArticle.id },
            })
          }
        }
      }

      // Revalidate article pages
      const articleForRevalidation = existingArticle || await prisma.article.findFirst({
        where: { translationGroupId: entityId, language: targetLanguage },
        select: { slug: true }
      })
      if (articleForRevalidation?.slug) {
        revalidatePath('/')
        revalidatePath('/en')
        revalidatePath('/ja')
        revalidatePath(`/posts/${articleForRevalidation.slug}`)
        revalidatePath(`/en/posts/${articleForRevalidation.slug}`)
        revalidatePath(`/ja/posts/${articleForRevalidation.slug}`)
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

      // Revalidate city pages
      const city = await prisma.city.findUnique({ 
        where: { id: entityId }, 
        select: { slug: true } 
      })
      if (city) {
        revalidatePath('/city')
        revalidatePath('/en/city')
        revalidatePath(`/city/${encodeURIComponent(city.slug)}`)
        revalidatePath(`/en/city/${encodeURIComponent(city.slug)}`)
      }
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

      // Revalidate anime pages
      revalidatePath('/anime')
      revalidatePath('/ja/anime')
      revalidatePath('/en/anime')
      revalidatePath(`/anime/${encodeURIComponent(entityId)}`)
      revalidatePath(`/ja/anime/${encodeURIComponent(entityId)}`)
      revalidatePath(`/en/anime/${encodeURIComponent(entityId)}`)
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
