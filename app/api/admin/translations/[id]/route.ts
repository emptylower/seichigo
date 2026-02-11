import { NextRequest, NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

export async function GET(
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

    let relatedArticle = null
    let translatedArticle = null
    let relatedEntity = null
    let translatedEntity = null
    if (task.entityType === 'article') {
      relatedArticle = await prisma.article.findUnique({
        where: { id: task.entityId },
        select: {
          updatedAt: true,
          contentJson: true,
        },
      })

      if (task.status === 'approved') {
        translatedArticle = await prisma.article.findFirst({
          where: {
            translationGroupId: task.entityId,
            language: task.targetLanguage,
          },
          select: {
            id: true,
            title: true,
            description: true,
            seoTitle: true,
            contentJson: true,
            updatedAt: true,
          },
        })
      }
    } else if (task.entityType === 'anitabi_bangumi') {
      const bangumiId = Number.parseInt(task.entityId, 10)
      if (Number.isFinite(bangumiId)) {
        relatedEntity = await prisma.anitabiBangumi.findUnique({
          where: { id: bangumiId },
          select: {
            id: true,
            titleZh: true,
            titleJaRaw: true,
            description: true,
            city: true,
            updatedAt: true,
          },
        })
        translatedEntity = await prisma.anitabiBangumiI18n.findUnique({
          where: {
            bangumiId_language: {
              bangumiId,
              language: task.targetLanguage,
            },
          },
          select: {
            title: true,
            description: true,
            city: true,
            updatedAt: true,
          },
        })
      }
    } else if (task.entityType === 'anitabi_point') {
      relatedEntity = await prisma.anitabiPoint.findUnique({
        where: { id: task.entityId },
        select: {
          id: true,
          name: true,
          nameZh: true,
          mark: true,
          updatedAt: true,
        },
      })
      translatedEntity = await prisma.anitabiPointI18n.findUnique({
        where: {
          pointId_language: {
            pointId: task.entityId,
            language: task.targetLanguage,
          },
        },
        select: {
          name: true,
          note: true,
          updatedAt: true,
        },
      })
    }

    return NextResponse.json({ task, relatedArticle, translatedArticle, relatedEntity, translatedEntity })
  } catch (error) {
    console.error('[api/admin/translations/[id]] GET failed', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerAuthSession()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { draftContent } = body

    const task = await prisma.translationTask.update({
      where: { id },
      data: { draftContent, updatedAt: new Date() },
    })

    return NextResponse.json({ ok: true, task })
  } catch (error) {
    console.error('[api/admin/translations/[id]] PATCH failed', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getServerAuthSession()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await prisma.translationTask.delete({
      where: { id },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[api/admin/translations/[id]] DELETE failed', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
