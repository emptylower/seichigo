import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { renderArticleContentHtmlFromJson } from '@/lib/article/repair'

function isEmptyDocContentJson(contentJson: unknown): boolean {
  if (!contentJson || typeof contentJson !== 'object') return true
  const doc = contentJson as any
  const content = doc?.content

  // Guard against the historical bug: approving/updating with empty content
  // would wipe the published article body.
  if (!Array.isArray(content)) return true
  return content.length === 0
}

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

    const body = await req.json().catch(() => null)
    const articleUpdatedAtRaw = (body as any)?.articleUpdatedAt
    const articleUpdatedAt =
      typeof articleUpdatedAtRaw === 'string' ? new Date(articleUpdatedAtRaw) : null

    if (!articleUpdatedAt || Number.isNaN(articleUpdatedAt.getTime())) {
      return NextResponse.json({ error: 'Invalid articleUpdatedAt' }, { status: 400 })
    }

    const task = await prisma.translationTask.findUnique({
      where: { id },
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    if (task.entityType !== 'article') {
      return NextResponse.json(
        { error: 'Unsupported translation entity type' },
        { status: 400 }
      )
    }

    if (!task.draftContent) {
      return NextResponse.json(
        { error: 'No draft content to publish' },
        { status: 400 }
      )
    }

    const draft = task.draftContent as any
    const contentJson = draft?.contentJson

    if (isEmptyDocContentJson(contentJson)) {
      return NextResponse.json({ error: 'contentJson is empty' }, { status: 400 })
    }

    const publishedArticle = await prisma.article.findFirst({
      where: {
        translationGroupId: task.entityId,
        language: task.targetLanguage,
      },
      select: {
        id: true,
        title: true,
        description: true,
        contentJson: true,
        contentHtml: true,
        slug: true,
        updatedAt: true,
      },
    })

    if (!publishedArticle) {
      return NextResponse.json({ error: 'Published article not found' }, { status: 404 })
    }

    if (publishedArticle.updatedAt.getTime() != articleUpdatedAt.getTime()) {
      return NextResponse.json({ error: 'Conflict' }, { status: 409 })
    }

    const nextContentHtml =
      typeof draft?.contentHtml === 'string' && draft.contentHtml.trim()
        ? draft.contentHtml
        : renderArticleContentHtmlFromJson(contentJson)

    const updateData: Record<string, unknown> = {
      ...(draft as Record<string, unknown>),
      contentJson,
      contentHtml: nextContentHtml,
    }

    await prisma.$transaction(async (tx) => {
      await tx.translationHistory.create({
        data: {
          translationTaskId: task.id,
          articleId: publishedArticle.id,
          createdById: session.user.id,
          content: {
            title: publishedArticle.title,
            description: publishedArticle.description,
            contentJson: publishedArticle.contentJson,
            contentHtml: publishedArticle.contentHtml,
          },
        },
      })

      await tx.article.update({
        where: { id: publishedArticle.id },
        data: updateData as any,
      })

      await tx.translationTask.update({
        where: { id: task.id },
        data: {
          finalContent: task.draftContent,
          updatedAt: new Date(),
        },
      })
    })

    // Best-effort cache revalidation.
    revalidatePath('/')
    revalidatePath('/en')
    revalidatePath('/ja')
    if (publishedArticle.slug) {
      revalidatePath(`/posts/${publishedArticle.slug}`)
      revalidatePath(`/en/posts/${publishedArticle.slug}`)
      revalidatePath(`/ja/posts/${publishedArticle.slug}`)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[api/admin/translations/[id]/update-published] POST failed', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
