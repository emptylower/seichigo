import type { PrismaClient } from '@prisma/client'
import {
  approveBatchMapTranslationTasks,
  approveTranslationTaskById,
} from '@/lib/translation/adminApproval'
import {
  executeMapRound,
  loadReadyTasks,
  runAdvanceOneKeyMapOps,
} from '@/lib/translation/mapOpsCore'
import {
  enqueueMapTranslationTasksForBackfill,
  type MapTaskEnqueueMode,
} from '@/lib/translation/mapTaskEnqueue'
import {
  appendUniqueMessages,
  collectErrorMessages,
  type MapOpsResult,
  type RunMapOpsInput,
} from '@/lib/translation/mapOpsShared'

function buildBackfillResult(input: {
  action: RunMapOpsInput['action']
  entityType: 'anitabi_bangumi' | 'anitabi_point'
  result: {
    scanned: number
    enqueued: number
    updated: number
    nextCursor: string | null
    done: boolean
  }
  continuation: RunMapOpsInput['continuation']
}): MapOpsResult {
  const { action, entityType, result, continuation } = input
  const detail = `${entityType} 回填完成：扫描 ${result.scanned}，新建 ${result.enqueued}，更新 ${result.updated}`

  return {
    ok: true,
    action,
    done: result.done,
    message: detail,
    bangumiBackfillCursor:
      entityType === 'anitabi_bangumi'
        ? (result.done ? null : result.nextCursor)
        : continuation?.bangumiBackfillCursor || null,
    pointBackfillCursor:
      entityType === 'anitabi_point'
        ? (result.done ? null : result.nextCursor)
        : continuation?.pointBackfillCursor || null,
    continuation: null,
    snapshot: {
      processed: result.scanned,
      success: result.enqueued,
      failed: 0,
      reclaimed: 0,
      skipped: result.updated,
      currentStep: 1,
      totalSteps: 1,
      detail,
      errors: [],
      oneKey: null,
    },
  }
}

export async function runMapOps(
  prisma: PrismaClient,
  input: RunMapOpsInput
): Promise<MapOpsResult> {
  if (input.action === 'backfill_once') {
    const entityType = input.entityType || 'anitabi_bangumi'
    const result = await enqueueMapTranslationTasksForBackfill({
      prisma,
      entityType,
      targetLanguages: ['zh', 'en', 'ja'],
      mode: input.mode || 'all',
      limit: 1000,
      cursor:
        entityType === 'anitabi_bangumi'
          ? input.continuation?.bangumiBackfillCursor || null
          : input.continuation?.pointBackfillCursor || null,
    })

    return buildBackfillResult({
      action: input.action,
      entityType,
      result,
      continuation: input.continuation,
    })
  }

  if (input.action === 'incremental_refill') {
    const [bangumiResult, pointResult] = await Promise.all([
      enqueueMapTranslationTasksForBackfill({
        prisma,
        entityType: 'anitabi_bangumi',
        targetLanguages: ['zh', 'en', 'ja'],
        mode: 'stale',
        limit: 1000,
        cursor: null,
      }),
      enqueueMapTranslationTasksForBackfill({
        prisma,
        entityType: 'anitabi_point',
        targetLanguages: ['zh', 'en', 'ja'],
        mode: 'stale',
        limit: 1000,
        cursor: null,
      }),
    ])

    const detail = `增量补队完成：作品 新建 ${bangumiResult.enqueued}/更新 ${bangumiResult.updated}，点位 新建 ${pointResult.enqueued}/更新 ${pointResult.updated}`
    return {
      ok: true,
      action: input.action,
      done: true,
      message: detail,
      bangumiBackfillCursor: null,
      pointBackfillCursor: null,
      continuation: null,
      snapshot: {
        processed: bangumiResult.scanned + pointResult.scanned,
        success: bangumiResult.enqueued + pointResult.enqueued,
        failed: 0,
        reclaimed: 0,
        skipped: bangumiResult.updated + pointResult.updated,
        currentStep: 2,
        totalSteps: 2,
        detail,
        errors: [],
        oneKey: null,
      },
    }
  }

  if (input.action === 'execute_round') {
    const result = await executeMapRound(prisma, {
      targetLanguage: input.targetLanguage,
      statusScope: input.statusScope || 'pending',
      limitPerType: input.limitPerType ?? 20,
      concurrency: input.concurrency ?? 2,
      q: input.q,
    })
    const translationFailed = Math.max(0, result.failed - result.reclaimedProcessing)
    const detail = `执行完成：处理 ${result.processed}，成功 ${result.success}，翻译失败 ${translationFailed}，回收 ${result.reclaimedProcessing}，跳过 ${result.skipped}`

    return {
      ok: true,
      action: input.action,
      done: true,
      message: detail,
      bangumiBackfillCursor: null,
      pointBackfillCursor: null,
      continuation: null,
      snapshot: {
        processed: result.processed,
        success: result.success,
        failed: translationFailed,
        reclaimed: result.reclaimedProcessing,
        skipped: result.skipped,
        currentStep: 1,
        totalSteps: 1,
        detail,
        errors: result.errorMessages,
        oneKey: null,
      },
    }
  }

  if (input.action === 'manual_advance') {
    const rounds = Math.max(1, Math.min(20, Math.floor(input.maxRounds || 10)))
    let processed = 0
    let success = 0
    let failed = 0
    let reclaimed = 0
    let skipped = 0
    let completedRounds = 0
    let errors: string[] = []
    let queueDrained = false

    for (let index = 0; index < rounds; index += 1) {
      const result = await executeMapRound(prisma, {
        targetLanguage: input.targetLanguage,
        statusScope: 'pending',
        limitPerType: 20,
        concurrency: 2,
      })
      if (result.total === 0 || result.processed === 0) {
        queueDrained = true
        break
      }
      completedRounds += 1
      processed += result.processed
      success += result.success
      failed += Math.max(0, result.failed - result.reclaimedProcessing)
      reclaimed += result.reclaimedProcessing
      skipped += result.skipped
      errors = appendUniqueMessages(errors, result.errorMessages)
    }

    const detail =
      completedRounds === 0
        ? '当前没有 pending 的地图翻译任务，队列已是最新状态'
        : `手动推进完成：共 ${completedRounds} 轮，处理 ${processed}，成功 ${success}，翻译失败 ${failed}，回收 ${reclaimed}，跳过 ${skipped}${queueDrained ? '（队列已清空）' : ''}`

    return {
      ok: true,
      action: input.action,
      done: true,
      message: detail,
      bangumiBackfillCursor: null,
      pointBackfillCursor: null,
      continuation: null,
      snapshot: {
        processed,
        success,
        failed,
        reclaimed,
        skipped,
        currentStep: completedRounds || 1,
        totalSteps: completedRounds || 1,
        detail,
        errors,
        oneKey: null,
      },
    }
  }

  if (input.action === 'approve_all_ready') {
    const maxRounds = Math.max(1, Math.min(1000, Math.floor(input.maxRounds || 1000)))
    let processed = 0
    let success = 0
    let failed = 0
    let skipped = 0
    let rounds = 0
    let errors: string[] = []
    let done = false

    for (let round = 1; round <= maxRounds; round += 1) {
      const readyTasks = await loadReadyTasks(prisma, {
        limit: 100,
        targetLanguage: input.targetLanguage,
      })
      if (readyTasks.length === 0) {
        done = true
        break
      }

      rounds = round
      const mapTaskIds = readyTasks
        .filter(
          (task) =>
            task.entityType === 'anitabi_bangumi' ||
            task.entityType === 'anitabi_point'
        )
        .map((task) => task.id)
      const nonMapTaskIds = readyTasks
        .filter(
          (task) =>
            task.entityType !== 'anitabi_bangumi' &&
            task.entityType !== 'anitabi_point'
        )
        .map((task) => task.id)

      if (mapTaskIds.length > 0) {
        const result = await approveBatchMapTranslationTasks(prisma, mapTaskIds)
        processed += result.total
        success += result.approved
        failed += result.failed
        skipped += result.skipped
        errors = appendUniqueMessages(errors, collectErrorMessages(result.results))
      }

      if (nonMapTaskIds.length > 0) {
        const results = await Promise.all(
          nonMapTaskIds.map(async (taskId) => {
            try {
              await approveTranslationTaskById(prisma, taskId)
              return { status: 'approved' as const }
            } catch (error) {
              return {
                status: 'failed' as const,
                error: error instanceof Error ? error.message : '审核失败',
              }
            }
          })
        )
        processed += results.length
        success += results.filter((row) => row.status === 'approved').length
        failed += results.filter((row) => row.status === 'failed').length
        errors = appendUniqueMessages(
          errors,
          results
            .filter((row) => row.status === 'failed')
            .map((row) => row.error || '审核失败')
        )
      }
    }

    const detail = done
      ? `一键审核完成：共 ${rounds} 轮，处理 ${processed}，通过 ${success}，失败 ${failed}，跳过 ${skipped}`
      : `一键审核暂停：共 ${rounds} 轮，处理 ${processed}，通过 ${success}，失败 ${failed}，跳过 ${skipped}`

    return {
      ok: true,
      action: input.action,
      done,
      message: detail,
      bangumiBackfillCursor: null,
      pointBackfillCursor: null,
      continuation: null,
      snapshot: {
        processed,
        success,
        failed,
        reclaimed: 0,
        skipped,
        currentStep: rounds || 1,
        totalSteps: rounds || 1,
        detail,
        errors,
        oneKey: null,
      },
    }
  }

  if (input.action === 'approve_sample') {
    const readyTasks = await loadReadyTasks(prisma, {
      limit: 300,
      targetLanguage: input.targetLanguage,
      mapOnly: true,
    })
    if (readyTasks.length === 0) {
      return {
        ok: true,
        action: input.action,
        done: true,
        message: '当前没有可抽检发布的地图 ready 任务',
        bangumiBackfillCursor: null,
        pointBackfillCursor: null,
        continuation: null,
        snapshot: {
          processed: 0,
          success: 0,
          failed: 0,
          reclaimed: 0,
          skipped: 0,
          currentStep: 1,
          totalSteps: 1,
          detail: '当前没有可抽检发布的地图 ready 任务',
          errors: [],
          oneKey: null,
        },
      }
    }

    const sampleSize = Math.min(input.sampleSize || 100, Math.max(1, readyTasks.length))
    const shuffled = readyTasks.slice().sort(() => Math.random() - 0.5)
    const sample = shuffled.slice(0, sampleSize)
    const result = await approveBatchMapTranslationTasks(
      prisma,
      sample.map((task) => task.id)
    )
    const detail = `抽检发布完成：通过 ${result.approved}，失败 ${result.failed}，跳过 ${result.skipped}`

    return {
      ok: true,
      action: input.action,
      done: true,
      message: detail,
      bangumiBackfillCursor: null,
      pointBackfillCursor: null,
      continuation: null,
      snapshot: {
        processed: result.total,
        success: result.approved,
        failed: result.failed,
        reclaimed: 0,
        skipped: result.skipped,
        currentStep: 2,
        totalSteps: 2,
        detail,
        errors: collectErrorMessages(result.results),
        oneKey: null,
      },
    }
  }

  return runAdvanceOneKeyMapOps(prisma, input)
}
