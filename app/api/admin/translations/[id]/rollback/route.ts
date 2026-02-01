import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { renderArticleContentHtmlFromJson } from '@/lib/article/repair'

function isEmptyDocContentJson(contentJson: unknown): boolean {
  if (!contentJson || typeof contentJson !== 'object') return true
  const doc = contentJson as any
  const content = doc?.content
  if (!Array.isArray(content)) return true
  return content.length === 0
}

class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
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
    const historyId = (body as any)?.historyId
    if (typeof historyId !== 'string' || !historyId.trim()) {
      return NextResponse.json({ error: 'Invalid historyId' }, { status: 400 })
    }

    const result = await prisma.$transaction(async (tx) => {
      const task = await tx.translationTask.findUnique({ where: { id } })
      if (!task) throw new HttpError(404, 'Task not found')
      if (task.entityType !== 'article') {
        throw new HttpError(400, 'Unsupported translation entity type')
      }

      const targetHistory = await tx.translationHistory.findUnique({
        where: { id: historyId },
      })

      // Hide whether a history ID exists if it doesn't belong to this task.
      if (!targetHistory || targetHistory.translationTaskId !== task.id) {
        throw new HttpError(404, 'History not found')
      }

      const currentArticle = await tx.article.findFirst({
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
        },
      })

      if (!currentArticle) {
        throw new HttpError(404, 'Published article not found')
      }

      const historyContent = (targetHistory as any).content
      const rollbackContentJson = historyContent?.contentJson
      if (isEmptyDocContentJson(rollbackContentJson)) {
        // Guard against the historical "empty content" regression.
        throw new HttpError(400, 'contentJson is empty')
      }

      const rollbackContentHtmlRaw = historyContent?.contentHtml
      const rollbackContentHtml =
        typeof rollbackContentHtmlRaw === 'string' && rollbackContentHtmlRaw.trim()
          ? rollbackContentHtmlRaw
          : renderArticleContentHtmlFromJson(rollbackContentJson)

      // Snapshot current article before rolling back.
      await tx.translationHistory.create({
        data: {
          translationTaskId: task.id,
          articleId: currentArticle.id,
          createdById: session.user.id,
          content: {
            title: currentArticle.title,
            description: currentArticle.description,
            contentJson: currentArticle.contentJson,
            contentHtml: currentArticle.contentHtml,
          },
        },
      })

      await tx.article.update({
        where: { id: currentArticle.id },
        data: {
          title: historyContent?.title,
          description: historyContent?.description,
          contentJson: rollbackContentJson,
          contentHtml: rollbackContentHtml,
        } as any,
      })

      await tx.translationTask.update({
        where: { id: task.id },
        data: {
          finalContent: historyContent as any,
          updatedAt: new Date(),
        } as any,
      })

      return { slug: currentArticle.slug }
    })

    // Best-effort cache revalidation.
    revalidatePath('/')
    revalidatePath('/en')
    revalidatePath('/ja')
    if (result.slug) {
      revalidatePath(`/posts/${result.slug}`)
      revalidatePath(`/en/posts/${result.slug}`)
      revalidatePath(`/ja/posts/${result.slug}`)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }

    console.error('[api/admin/translations/[id]/rollback] POST failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
