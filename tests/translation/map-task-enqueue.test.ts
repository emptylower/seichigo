import { describe, expect, it, vi } from 'vitest'
import {
  enqueueMapTranslationTasksForBackfill,
  enqueueMapTranslationTasksForBangumiIds,
} from '@/lib/translation/mapTaskEnqueue'

describe('mapTaskEnqueue', () => {
  it('creates missing map point tasks in backfill mode', async () => {
    const prisma: any = {
      anitabiPoint: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'p1',
            name: '原名',
            nameZh: '中文名',
            mark: '备注',
            i18n: [],
          },
        ]),
      },
      translationTask: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 't1' }),
        update: vi.fn(),
      },
    }

    const result = await enqueueMapTranslationTasksForBackfill({
      prisma,
      entityType: 'anitabi_point',
      mode: 'missing',
      targetLanguages: ['en'],
      limit: 1000,
      cursor: null,
    })

    expect(result).toMatchObject({
      scanned: 1,
      enqueued: 1,
      updated: 0,
      done: true,
      nextCursor: 'p1',
    })
    expect(prisma.translationTask.create).toHaveBeenCalledTimes(1)
  })

  it('updates stale tasks when source hash changes', async () => {
    const prisma: any = {
      anitabiBangumi: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 100,
            titleZh: '作品A',
            description: '描述A',
            city: '东京',
            i18n: [{ language: 'en', sourceHash: 'old-hash' }],
          },
        ]),
      },
      anitabiPoint: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      translationTask: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'task-1',
            entityId: '100',
            targetLanguage: 'en',
            status: 'approved',
            sourceHash: 'old-hash',
          },
        ]),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
    }

    const result = await enqueueMapTranslationTasksForBangumiIds({
      prisma,
      bangumiIds: [100],
      targetLanguages: ['en'],
      mode: 'stale',
    })

    expect(result).toMatchObject({
      scannedBangumi: 1,
      scannedPoint: 0,
      enqueued: 0,
      updated: 1,
    })
    expect(prisma.translationTask.update).toHaveBeenCalledTimes(1)
  })
})
