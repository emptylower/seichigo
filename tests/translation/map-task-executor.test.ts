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
    delete process.env.VERCEL
    delete process.env.VERCEL_ENV
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

  it('uses smaller batches and a softer timeout budget on Vercel', async () => {
    process.env.VERCEL = '1'

    const prisma = createPrismaMock()
    prisma.anitabiBangumi.findMany.mockResolvedValue([
      {
        id: 1,
        titleZh: 'Title 1',
        description: 'Description 1',
        city: 'City 1',
      },
      {
        id: 2,
        titleZh: 'Title 2',
        description: 'Description 2',
        city: 'City 2',
      },
      {
        id: 3,
        titleZh: 'Title 3',
        description: 'Description 3',
        city: 'City 3',
      },
    ])

    mocks.translateTextBatch.mockImplementation((texts: string[]) =>
      Promise.resolve(new Map(texts.map((text) => [text, `${text} EN`])))
    )

    const { executeMapTranslationTasks } = await import('@/lib/translation/mapTaskExecutor')
    await executeMapTranslationTasks({
      prisma: prisma as any,
      tasks: [
        { id: 'task-1', entityType: 'anitabi_bangumi', entityId: '1', targetLanguage: 'en' },
        { id: 'task-2', entityType: 'anitabi_bangumi', entityId: '2', targetLanguage: 'en' },
        { id: 'task-3', entityType: 'anitabi_bangumi', entityId: '3', targetLanguage: 'en' },
      ],
      concurrency: 1,
    })

    expect(mocks.translateTextBatch).toHaveBeenCalledTimes(2)
    expect(mocks.translateTextBatch).toHaveBeenNthCalledWith(
      1,
      [
        'Title 1',
        'Description 1',
        'City 1',
        'Title 2',
        'Description 2',
        'City 2',
        'Title 3',
        'Description 3',
      ],
      'en',
      {
        callOptions: {
          maxRetries: 1,
          requestTimeoutMs: 15_000,
          initialBackoffMs: 250,
          maxBackoffMs: 1_000,
        },
        fallbackMode: 'error',
      }
    )
    expect(mocks.translateTextBatch).toHaveBeenNthCalledWith(
      2,
      ['City 3'],
      'en',
      {
        callOptions: {
          maxRetries: 1,
          requestTimeoutMs: 15_000,
          initialBackoffMs: 250,
          maxBackoffMs: 1_000,
        },
        fallbackMode: 'error',
      }
    )
  })
})
