import type { PrismaClient } from '@prisma/client'
import { BATCH_SIZE, MAX_BATCH_CHARS, translateTextBatch } from '@/lib/translation/gemini'
import {
  selectBangumiSourceForTarget,
  selectPointSourceForTarget,
} from '@/lib/translation/mapLocale'
import { getMapTaskExecutionProfile } from '@/lib/translation/runtimeProfile'

export type MapTaskExecutionInputTask = {
  id: string
  entityType: string
  entityId: string
  targetLanguage: string
}

export type MapTaskExecutionResult = {
  taskId: string
  status: 'ready' | 'failed'
  error?: string
}

export type ExecuteMapTranslationTasksInput = {
  prisma: PrismaClient
  tasks: MapTaskExecutionInputTask[]
  concurrency?: number
}

type TranslateTextsResult = {
  translated: Map<string, string>
  failed: Map<string, string>
}

function normalizeConcurrency(input: number | null | undefined): number {
  if (!Number.isFinite(input)) return 4
  return Math.max(1, Math.min(12, Math.floor(Number(input))))
}

function splitIntoBatches(texts: string[], maxCount: number, maxChars: number): string[][] {
  const batches: string[][] = []
  let currentBatch: string[] = []
  let currentChars = 0

  for (const text of texts) {
    const textLength = text.length

    if (currentBatch.length >= maxCount || (currentChars + textLength > maxChars && currentBatch.length > 0)) {
      batches.push(currentBatch)
      currentBatch = []
      currentChars = 0
    }

    currentBatch.push(text)
    currentChars += textLength
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }

  return batches
}

function isGeminiTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.message.toLowerCase().includes('timed out')
}

function mergeTextResults(target: TranslateTextsResult, incoming: TranslateTextsResult): void {
  for (const [original, translated] of incoming.translated.entries()) {
    target.translated.set(original, translated)
  }
  for (const [original, error] of incoming.failed.entries()) {
    if (!target.failed.has(original)) {
      target.failed.set(original, error)
    }
  }
}

async function translateBatchWithTimeoutFallback(
  texts: string[],
  targetLanguage: string,
  executionProfile: ReturnType<typeof getMapTaskExecutionProfile>,
  useTimeoutFallback = false
): Promise<TranslateTextsResult> {
  if (texts.length === 0) {
    return {
      translated: new Map(),
      failed: new Map(),
    }
  }

  const callOptions =
    useTimeoutFallback && executionProfile.timeoutFallbackCallOptions
      ? executionProfile.timeoutFallbackCallOptions
      : executionProfile.callOptions

  try {
    const translated = await translateTextBatch(texts, targetLanguage, {
      callOptions,
      fallbackMode: 'error',
    })
    return {
      translated,
      failed: new Map(),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Translation failed'

    if (isGeminiTimeoutError(error)) {
      if (
        texts.length === 1 &&
        !useTimeoutFallback &&
        executionProfile.timeoutFallbackCallOptions
      ) {
        return translateBatchWithTimeoutFallback(
          texts,
          targetLanguage,
          executionProfile,
          true
        )
      }

      if (texts.length > 1) {
        const midpoint = Math.ceil(texts.length / 2)
        const merged: TranslateTextsResult = {
          translated: new Map(),
          failed: new Map(),
        }

        mergeTextResults(
          merged,
          await translateBatchWithTimeoutFallback(
            texts.slice(0, midpoint),
            targetLanguage,
            executionProfile,
            true
          )
        )
        mergeTextResults(
          merged,
          await translateBatchWithTimeoutFallback(
            texts.slice(midpoint),
            targetLanguage,
            executionProfile,
            true
          )
        )

        return merged
      }
    }

    return {
      translated: new Map(),
      failed: new Map(texts.map((text) => [text, message])),
    }
  }
}

function resolveTextFailure(
  failedTexts: Map<string, string>,
  values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    const text = String(value || '').trim()
    if (!text) continue
    const error = failedTexts.get(text)
    if (error) return error
  }
  return null
}

async function translateTextsByLanguage(
  texts: string[],
  targetLanguage: string
): Promise<TranslateTextsResult> {
  const normalized = Array.from(
    new Set(texts.map((text) => String(text || '').trim()).filter(Boolean))
  )
  if (normalized.length === 0) {
    return {
      translated: new Map(),
      failed: new Map(),
    }
  }

  const executionProfile = getMapTaskExecutionProfile()
  const batches = splitIntoBatches(
    normalized,
    Math.min(BATCH_SIZE, executionProfile.batchSize),
    Math.min(MAX_BATCH_CHARS, executionProfile.batchChars)
  )
  const merged: TranslateTextsResult = {
    translated: new Map(),
    failed: new Map(),
  }

  for (const batch of batches) {
    const result = await translateBatchWithTimeoutFallback(
      batch,
      targetLanguage,
      executionProfile
    )
    mergeTextResults(merged, result)
    for (const original of batch) {
      if (result.failed.has(original)) continue
      merged.translated.set(
        original,
        result.translated.get(original) || original
      )
    }
  }

  return merged
}

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return
  const concurrency = Math.max(1, Math.min(limit, items.length))
  let cursor = 0

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (cursor < items.length) {
        const index = cursor
        cursor += 1
        await fn(items[index]!)
      }
    })
  )
}

async function updateTaskReady(input: {
  prisma: PrismaClient
  taskId: string
  sourceHash: string
  sourceContent: Record<string, unknown>
  draftContent: Record<string, unknown>
}) {
  await input.prisma.translationTask.update({
    where: { id: input.taskId },
    data: {
      status: 'ready',
      sourceHash: input.sourceHash,
      sourceContent: input.sourceContent as any,
      draftContent: input.draftContent as any,
      error: null,
      updatedAt: new Date(),
    } as any,
  })
}

async function updateTaskFailed(prisma: PrismaClient, taskId: string, error: string): Promise<void> {
  await prisma.translationTask.update({
    where: { id: taskId },
    data: {
      status: 'failed',
      error,
      updatedAt: new Date(),
    },
  })
}

async function executeBangumiTasks(
  prisma: PrismaClient,
  tasks: MapTaskExecutionInputTask[],
  concurrency: number,
  results: Map<string, MapTaskExecutionResult>
): Promise<void> {
  if (tasks.length === 0) return

  const bangumiIds = Array.from(
    new Set(
      tasks
        .map((task) => Number.parseInt(task.entityId, 10))
        .filter((id) => Number.isFinite(id))
    )
  )

  const rows = await prisma.anitabiBangumi.findMany({
    where: {
      id: { in: bangumiIds },
    },
    select: {
      id: true,
      titleZh: true,
      titleJaRaw: true,
      titleEnglish: true,
      titleOriginal: true,
      description: true,
      city: true,
      i18n: {
        where: { language: { in: ['zh', 'en', 'ja'] } },
        select: {
          language: true,
          sourceHash: true,
          title: true,
          description: true,
          city: true,
        },
      },
    },
  })

  const rowById = new Map(rows.map((row) => [String(row.id), row]))
  const tasksByLanguage = new Map<string, MapTaskExecutionInputTask[]>()

  for (const task of tasks) {
    const list = tasksByLanguage.get(task.targetLanguage)
    if (list) {
      list.push(task)
    } else {
      tasksByLanguage.set(task.targetLanguage, [task])
    }
  }

  for (const [targetLanguage, languageTasks] of tasksByLanguage.entries()) {
    const texts: string[] = []

    for (const task of languageTasks) {
      const row = rowById.get(task.entityId)
      if (!row) continue

      const source = selectBangumiSourceForTarget(
        row,
        targetLanguage as 'zh' | 'en' | 'ja'
      ).sourceContent as {
        title: string
        description: string | null
        city: string | null
      }

      if (source.title) texts.push(source.title)
      if (source.description) texts.push(source.description)
      if (source.city) texts.push(source.city)
    }

    let translationResult: TranslateTextsResult
    try {
      translationResult = await translateTextsByLanguage(texts, targetLanguage)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Translation failed'
      await runWithConcurrency(languageTasks, concurrency, async (task) => {
        await updateTaskFailed(prisma, task.id, message)
        results.set(task.id, { taskId: task.id, status: 'failed', error: message })
      })
      continue
    }

    await runWithConcurrency(languageTasks, concurrency, async (task) => {
      const row = rowById.get(task.entityId)
      if (!row) {
        const error = 'Bangumi not found'
        await updateTaskFailed(prisma, task.id, error)
        results.set(task.id, { taskId: task.id, status: 'failed', error })
        return
      }

      try {
        const { sourceHash, sourceContent } = selectBangumiSourceForTarget(
          row,
          targetLanguage as 'zh' | 'en' | 'ja'
        )

        const source = sourceContent as {
          title: string
          description: string | null
          city: string | null
        }

        const translateError = resolveTextFailure(
          translationResult.failed,
          [source.title, source.description, source.city]
        )
        if (translateError) {
          await updateTaskFailed(prisma, task.id, translateError)
          results.set(task.id, { taskId: task.id, status: 'failed', error: translateError })
          return
        }

        const draftContent = {
          title: source.title
            ? translationResult.translated.get(source.title) || source.title
            : source.title,
          description: source.description
            ? translationResult.translated.get(source.description) || source.description
            : null,
          city: source.city
            ? translationResult.translated.get(source.city) || source.city
            : null,
        }

        await updateTaskReady({
          prisma,
          taskId: task.id,
          sourceHash,
          sourceContent,
          draftContent,
        })

        results.set(task.id, { taskId: task.id, status: 'ready' })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Translation failed'
        await updateTaskFailed(prisma, task.id, message)
        results.set(task.id, { taskId: task.id, status: 'failed', error: message })
      }
    })
  }
}

async function executePointTasks(
  prisma: PrismaClient,
  tasks: MapTaskExecutionInputTask[],
  concurrency: number,
  results: Map<string, MapTaskExecutionResult>
): Promise<void> {
  if (tasks.length === 0) return

  const pointIds = Array.from(new Set(tasks.map((task) => String(task.entityId)).filter(Boolean)))

  const rows = await prisma.anitabiPoint.findMany({
    where: {
      id: { in: pointIds },
    },
    select: {
      id: true,
      name: true,
      nameZh: true,
      mark: true,
      i18n: {
        where: { language: { in: ['zh', 'en', 'ja'] } },
        select: {
          language: true,
          sourceHash: true,
          name: true,
          note: true,
        },
      },
    },
  })

  const rowById = new Map(rows.map((row) => [row.id, row]))
  const tasksByLanguage = new Map<string, MapTaskExecutionInputTask[]>()

  for (const task of tasks) {
    const list = tasksByLanguage.get(task.targetLanguage)
    if (list) {
      list.push(task)
    } else {
      tasksByLanguage.set(task.targetLanguage, [task])
    }
  }

  for (const [targetLanguage, languageTasks] of tasksByLanguage.entries()) {
    const texts: string[] = []

    for (const task of languageTasks) {
      const row = rowById.get(task.entityId)
      if (!row) continue

      const source = selectPointSourceForTarget(
        row,
        targetLanguage as 'zh' | 'en' | 'ja'
      ).sourceContent as {
        name: string
        note: string | null
      }

      if (source.name) texts.push(source.name)
      if (source.note) texts.push(source.note)
    }

    let translationResult: TranslateTextsResult
    try {
      translationResult = await translateTextsByLanguage(texts, targetLanguage)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Translation failed'
      await runWithConcurrency(languageTasks, concurrency, async (task) => {
        await updateTaskFailed(prisma, task.id, message)
        results.set(task.id, { taskId: task.id, status: 'failed', error: message })
      })
      continue
    }

    await runWithConcurrency(languageTasks, concurrency, async (task) => {
      const row = rowById.get(task.entityId)
      if (!row) {
        const error = 'Point not found'
        await updateTaskFailed(prisma, task.id, error)
        results.set(task.id, { taskId: task.id, status: 'failed', error })
        return
      }

      try {
        const { sourceHash, sourceContent } = selectPointSourceForTarget(
          row,
          targetLanguage as 'zh' | 'en' | 'ja'
        )

        const source = sourceContent as {
          name: string
          note: string | null
        }

        const translateError = resolveTextFailure(
          translationResult.failed,
          [source.name, source.note]
        )
        if (translateError) {
          await updateTaskFailed(prisma, task.id, translateError)
          results.set(task.id, { taskId: task.id, status: 'failed', error: translateError })
          return
        }

        const draftContent = {
          name: source.name
            ? translationResult.translated.get(source.name) || source.name
            : source.name,
          note: source.note
            ? translationResult.translated.get(source.note) || source.note
            : null,
        }

        await updateTaskReady({
          prisma,
          taskId: task.id,
          sourceHash,
          sourceContent,
          draftContent,
        })

        results.set(task.id, { taskId: task.id, status: 'ready' })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Translation failed'
        await updateTaskFailed(prisma, task.id, message)
        results.set(task.id, { taskId: task.id, status: 'failed', error: message })
      }
    })
  }
}

export async function executeMapTranslationTasks(input: ExecuteMapTranslationTasksInput): Promise<MapTaskExecutionResult[]> {
  const mapTasks = input.tasks.filter(
    (task) => task.entityType === 'anitabi_bangumi' || task.entityType === 'anitabi_point'
  )

  if (mapTasks.length === 0) return []

  const concurrency = normalizeConcurrency(input.concurrency)
  const results = new Map<string, MapTaskExecutionResult>()

  const bangumiTasks = mapTasks.filter((task) => task.entityType === 'anitabi_bangumi')
  const pointTasks = mapTasks.filter((task) => task.entityType === 'anitabi_point')

  await executeBangumiTasks(input.prisma, bangumiTasks, concurrency, results)
  await executePointTasks(input.prisma, pointTasks, concurrency, results)

  return mapTasks
    .map((task) => results.get(task.id) || { taskId: task.id, status: 'failed', error: 'Execution skipped' })
}
