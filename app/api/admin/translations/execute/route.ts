import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { translateArticle, translateCity, translateAnime } from '@/lib/translation/service'

const executeSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1).max(200),
})

type ExecuteResult = {
  taskId: string
  status: 'ready' | 'failed' | 'skipped'
  error?: string
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    const parsed = executeSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || '参数错误' },
        { status: 400 }
      )
    }

    const taskIds = Array.from(new Set(parsed.data.taskIds.map((id) => String(id).trim()).filter(Boolean)))
    if (!taskIds.length) {
      return NextResponse.json({ error: 'No valid task IDs provided' }, { status: 400 })
    }

    const tasks = await prisma.translationTask.findMany({
      where: { id: { in: taskIds } },
      select: {
        id: true,
        entityType: true,
        entityId: true,
        targetLanguage: true,
        status: true,
      },
    })
    const taskById = new Map(tasks.map((t) => [t.id, t]))

    const results: ExecuteResult[] = []
    let success = 0
    let failed = 0
    let skipped = 0

    for (const taskId of taskIds) {
      const task = taskById.get(taskId)
      if (!task) {
        skipped += 1
        results.push({ taskId, status: 'skipped', error: 'Task not found' })
        continue
      }

      if (task.status !== 'pending' && task.status !== 'failed') {
        skipped += 1
        results.push({ taskId, status: 'skipped', error: `Task status is ${task.status}` })
        continue
      }

      await prisma.translationTask.update({
        where: { id: taskId },
        data: {
          status: 'processing',
          error: null,
          updatedAt: new Date(),
        },
      })

      try {
        let result
        if (task.entityType === 'article') {
          result = await translateArticle(task.entityId, task.targetLanguage)
        } else if (task.entityType === 'city') {
          result = await translateCity(task.entityId, task.targetLanguage)
        } else if (task.entityType === 'anime') {
          result = await translateAnime(task.entityId, task.targetLanguage)
        } else {
          result = { success: false, error: 'Unknown entity type' as string }
        }

        if (result.success) {
          await prisma.translationTask.update({
            where: { id: taskId },
            data: {
              status: 'ready',
              sourceContent: result.sourceContent,
              draftContent: result.translatedContent,
              error: null,
              updatedAt: new Date(),
            },
          })
          success += 1
          results.push({ taskId, status: 'ready' })
        } else {
          const errorMsg = result.error || 'Translation failed'
          await prisma.translationTask.update({
            where: { id: taskId },
            data: {
              status: 'failed',
              error: errorMsg,
              updatedAt: new Date(),
            },
          })
          failed += 1
          results.push({ taskId, status: 'failed', error: errorMsg })
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        try {
          await prisma.translationTask.update({
            where: { id: taskId },
            data: {
              status: 'failed',
              error: errorMsg,
              updatedAt: new Date(),
            },
          })
        } catch (updateError) {
          console.error('[api/admin/translations/execute] failed to update task status', updateError)
        }
        failed += 1
        results.push({ taskId, status: 'failed', error: errorMsg })
      }
    }

    return NextResponse.json({
      ok: true,
      total: taskIds.length,
      processed: success + failed,
      success,
      failed,
      skipped,
      results,
    })
  } catch (error) {
    console.error('[api/admin/translations/execute] POST failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
