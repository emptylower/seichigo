import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  translateTextBatch: vi.fn(),
}))

vi.mock('@/lib/translation/gemini', () => ({
  BATCH_SIZE: 100,
  MAX_BATCH_CHARS: 50_000,
  translateTextBatch: (...args: any[]) => mocks.translateTextBatch(...args),
}))

function createPrismaMock() {
  return {
    anitabiBangumi: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    anitabiPoint: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    translationTask: {
      update: vi.fn().mockResolvedValue({}),
    },
  }
}

describe('mapTaskExecutor', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('marks bangumi tasks ready with translated draft content', async () => {
    const prisma = createPrismaMock()
    prisma.anitabiBangumi.findMany.mockResolvedValue([
      {
        id: 1,
        titleZh: 'Source title',
        description: 'Source description',
        city: 'Tokyo',
      },
    ])

    mocks.translateTextBatch.mockResolvedValue(
      new Map([
        ['Source title', 'Translated title'],
        ['Source description', 'Translated description'],
        ['Tokyo', 'Tokyo EN'],
      ])
    )

    const { executeMapTranslationTasks } = await import('@/lib/translation/mapTaskExecutor')
    const results = await executeMapTranslationTasks({
      prisma: prisma as any,
      tasks: [{ id: 'task-1', entityType: 'anitabi_bangumi', entityId: '1', targetLanguage: 'en' }],
      concurrency: 2,
    })

    expect(results).toEqual([{ taskId: 'task-1', status: 'ready' }])
    expect(mocks.translateTextBatch).toHaveBeenCalledWith(
      ['Source title', 'Source description', 'Tokyo'],
      'en',
      {
        callOptions: {
          maxRetries: 0,
          requestTimeoutMs: 8_000,
        },
        fallbackMode: 'error',
      }
    )
    expect(prisma.translationTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          status: 'ready',
          sourceHash: expect.any(String),
          sourceContent: {
            title: 'Source title',
            description: 'Source description',
            city: 'Tokyo',
          },
          draftContent: {
            title: 'Translated title',
            description: 'Translated description',
            city: 'Tokyo EN',
          },
        }),
      })
    )
  })

  it('marks point tasks failed when batch translation throws', async () => {
    const prisma = createPrismaMock()
    prisma.anitabiPoint.findMany.mockResolvedValue([
      {
        id: 'point-1',
        name: 'Point fallback',
        nameZh: 'Point source',
        mark: 'Point note',
      },
    ])

    mocks.translateTextBatch.mockRejectedValue(new Error('Gemini quota exceeded'))

    const { executeMapTranslationTasks } = await import('@/lib/translation/mapTaskExecutor')
    const results = await executeMapTranslationTasks({
      prisma: prisma as any,
      tasks: [{ id: 'task-2', entityType: 'anitabi_point', entityId: 'point-1', targetLanguage: 'en' }],
      concurrency: 2,
    })

    expect(results).toEqual([{ taskId: 'task-2', status: 'failed', error: 'Gemini quota exceeded' }])
    expect(prisma.translationTask.update).toHaveBeenCalledWith({
      where: { id: 'task-2' },
      data: expect.objectContaining({
        status: 'failed',
        error: 'Gemini quota exceeded',
        updatedAt: expect.any(Date),
      }),
    })
  })
})
