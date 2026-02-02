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
    }

    return NextResponse.json({ task, relatedArticle, translatedArticle })
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
