import { NextRequest, NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { translateArticle, translateCity, translateAnime } from '@/lib/translation/service'

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

    await prisma.translationTask.update({
      where: { id },
      data: {
        status: 'processing',
        updatedAt: new Date(),
      },
    })

    let result
    if (task.entityType === 'article') {
      result = await translateArticle(task.entityId, task.targetLanguage)
    } else if (task.entityType === 'city') {
      result = await translateCity(task.entityId, task.targetLanguage)
    } else if (task.entityType === 'anime') {
      result = await translateAnime(task.entityId, task.targetLanguage)
    } else {
      return NextResponse.json(
        { error: 'Unknown entity type' },
        { status: 400 }
      )
    }
    if (result.success) {
      await prisma.translationTask.update({
        where: { id },
        data: {
          status: 'ready',
          sourceContent: result.sourceContent,
          draftContent: result.translatedContent,
          error: null,
          updatedAt: new Date(),
        },
      })
    } else {
      await prisma.translationTask.update({
        where: { id },
        data: {
          status: 'failed',
          error: result.error,
          updatedAt: new Date(),
        },
      })
    }

    return NextResponse.json({
      ok: true,
      status: result.success ? 'ready' : 'failed',
    })
  } catch (error) {
    console.error('[api/admin/translations/[id]/translate] POST failed', error)
    
    try {
      const { id } = await params
      await prisma.translationTask.update({
        where: { id },
        data: {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          updatedAt: new Date(),
        },
      })
    } catch (updateError) {
      console.error('Failed to update task status', updateError)
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
