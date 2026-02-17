import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { safeRevalidatePath } from '@/lib/next/revalidate'
import { buildBangumiSourceHash, buildPointSourceHash } from '@/lib/translation/mapSourceHash'

const approveBatchSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1).max(1000),
})

type ApproveBatchResult = {
  taskId: string
  status: 'approved' | 'skipped' | 'failed'
  error?: string
}

function resolveTaskSourceHash(task: {
  entityType: string
  sourceHash: string | null
  sourceContent: unknown
  draftContent: unknown
}): string | null {
  if (task.sourceHash) return task.sourceHash

  if (task.entityType === 'anitabi_bangumi') {
    const source = task.sourceContent as { title?: string; description?: string | null; city?: string | null } | null
    const draft = task.draftContent as { title?: string; description?: string | null; city?: string | null } | null
    return buildBangumiSourceHash({
      titleZh: source?.title || draft?.title || '',
      description: source?.description || draft?.description || null,
      city: source?.city || draft?.city || null,
    })
  }

  if (task.entityType === 'anitabi_point') {
    const source = task.sourceContent as { name?: string; note?: string | null } | null
    const draft = task.draftContent as { name?: string; note?: string | null } | null
    return buildPointSourceHash({
      name: source?.name || draft?.name || '',
      nameZh: source?.name || draft?.name || '',
      mark: source?.note || draft?.note || null,
    })
  }

  return null
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    const parsed = approveBatchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || '参数错误' },
        { status: 400 }
      )
    }

    const taskIds = Array.from(new Set(parsed.data.taskIds.map((taskId) => String(taskId).trim()).filter(Boolean)))
    if (taskIds.length === 0) {
      return NextResponse.json({ error: 'No valid task IDs provided' }, { status: 400 })
    }

    const tasks = await prisma.translationTask.findMany({
      where: {
        id: { in: taskIds },
      },
      select: {
        id: true,
        entityType: true,
        entityId: true,
        targetLanguage: true,
        status: true,
        sourceHash: true,
        sourceContent: true,
        draftContent: true,
      },
    })

    const taskById = new Map(tasks.map((task) => [task.id, task]))
    const results: ApproveBatchResult[] = []

    for (const taskId of taskIds) {
      const task = taskById.get(taskId)
      if (!task) {
        results.push({ taskId, status: 'skipped', error: 'Task not found' })
        continue
      }

      if (task.status !== 'ready') {
        results.push({ taskId, status: 'skipped', error: `Task status is ${task.status}` })
        continue
      }

      if (task.entityType !== 'anitabi_bangumi' && task.entityType !== 'anitabi_point') {
        results.push({ taskId, status: 'skipped', error: `Unsupported entity type ${task.entityType}` })
        continue
      }

      if (!task.draftContent || typeof task.draftContent !== 'object') {
        results.push({ taskId, status: 'failed', error: 'No draft content to approve' })
        continue
      }

      try {
        const sourceHash = resolveTaskSourceHash(task)

        if (task.entityType === 'anitabi_bangumi') {
          const bangumiId = Number.parseInt(String(task.entityId), 10)
          if (!Number.isFinite(bangumiId)) {
            results.push({ taskId, status: 'failed', error: 'Invalid bangumi id' })
            continue
          }

          const content = task.draftContent as { title?: string | null; description?: string | null; city?: string | null }

          await prisma.anitabiBangumiI18n.upsert({
            where: {
              bangumiId_language: {
                bangumiId,
                language: task.targetLanguage,
              },
            },
            create: {
              bangumiId,
              language: task.targetLanguage,
              sourceHash,
              title: content.title ?? null,
              description: content.description ?? null,
              city: content.city ?? null,
            } as any,
            update: {
              sourceHash,
              title: content.title ?? null,
              description: content.description ?? null,
              city: content.city ?? null,
            } as any,
          })
        }

        if (task.entityType === 'anitabi_point') {
          const content = task.draftContent as { name?: string | null; note?: string | null }

          await prisma.anitabiPointI18n.upsert({
            where: {
              pointId_language: {
                pointId: task.entityId,
                language: task.targetLanguage,
              },
            },
            create: {
              pointId: task.entityId,
              language: task.targetLanguage,
              sourceHash,
              name: content.name ?? null,
              note: content.note ?? null,
            } as any,
            update: {
              sourceHash,
              name: content.name ?? null,
              note: content.note ?? null,
            } as any,
          })
        }

        await prisma.translationTask.update({
          where: { id: taskId },
          data: {
            status: 'approved',
            finalContent: task.draftContent as any,
            sourceHash,
            updatedAt: new Date(),
          } as any,
        })

        results.push({ taskId, status: 'approved' })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Approve failed'
        results.push({ taskId, status: 'failed', error: message })
      }
    }

    safeRevalidatePath('/map')
    safeRevalidatePath('/en/map')
    safeRevalidatePath('/ja/map')

    const approved = results.filter((row) => row.status === 'approved').length
    const skipped = results.filter((row) => row.status === 'skipped').length
    const failed = results.filter((row) => row.status === 'failed').length

    return NextResponse.json({
      ok: true,
      total: taskIds.length,
      approved,
      skipped,
      failed,
      results,
    })
  } catch (error) {
    console.error('[api/admin/translations/approve-batch] POST failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
