import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTranslationBatchExecution } from '@/app/(authed)/admin/translations/useTranslationBatchExecution'

function jsonResponse(data: unknown, ok = true) {
  return Promise.resolve({
    ok,
    json: async () => data,
  })
}

function makeTasks(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `task-${index + 1}`,
    entityType: 'article',
    entityId: `article-${index + 1}`,
    targetLanguage: 'ja',
    status: 'pending',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    error: null,
    subject: {
      title: `标题 ${index + 1}`,
      subtitle: `slug-${index + 1}`,
      slug: `slug-${index + 1}`,
    },
    target: null,
  }))
}

describe('useTranslationBatchExecution', () => {
  const toast = {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }
  const reloadAll = vi.fn(async () => undefined)

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('loads only the current pending page when modal opens', async () => {
    const fetchMock = vi.fn((url: string) => {
      expect(url).toContain('/api/admin/translations?')
      expect(url).toContain('status=pending')
      expect(url).toContain('entityType=article')
      expect(url).toContain('targetLanguage=ja')
      expect(url).toContain('q=tokyo')
      expect(url).toContain('page=1')
      expect(url).toContain('pageSize=50')
      return jsonResponse({ tasks: makeTasks(3), total: 3 })
    })
    global.fetch = fetchMock as any

    const { result } = renderHook(() =>
      useTranslationBatchExecution({
        entityType: 'article',
        targetLanguage: 'ja',
        q: ' tokyo ',
        toast,
        reloadAll,
      })
    )

    expect(fetchMock).not.toHaveBeenCalled()

    act(() => {
      result.current.setShowBatchModal(true)
    })

    await waitFor(() => {
      expect(result.current.batchTaskItems).toHaveLength(3)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.batchTaskItems).toHaveLength(3)
    expect(result.current.batchSelectedIds).toHaveLength(3)
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/admin/translations/execute',
      expect.anything()
    )
  })

  it('chunks selected task ids into 25-item execute requests', async () => {
    const executeBodies: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith('/api/admin/translations?')) {
        return jsonResponse({ tasks: makeTasks(30), total: 30 })
      }

      if (url === '/api/admin/translations/execute') {
        const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        executeBodies.push(body)
        const taskIds = Array.isArray(body.taskIds) ? body.taskIds : []
        return jsonResponse({
          total: taskIds.length,
          success: taskIds.length,
          failed: 0,
          skipped: 0,
        })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })
    global.fetch = fetchMock as any

    const { result } = renderHook(() =>
      useTranslationBatchExecution({
        entityType: 'article',
        targetLanguage: 'ja',
        q: '',
        toast,
        reloadAll,
      })
    )

    act(() => {
      result.current.setShowBatchModal(true)
    })

    await waitFor(() => {
      expect(result.current.batchSelectedIds).toHaveLength(30)
    })

    await act(async () => {
      await result.current.handleBatchSubmit()
    })

    await waitFor(() => {
      expect(reloadAll).toHaveBeenCalledTimes(1)
    })

    expect(executeBodies).toHaveLength(2)
    expect(executeBodies[0].taskIds).toHaveLength(25)
    expect(executeBodies[1].taskIds).toHaveLength(5)
    expect(toast.success).toHaveBeenCalledWith(
      '已执行 30 个，成功 30 个，失败 0 个，跳过 0 个'
    )
  })

  it('uses filter mode without preloading all task ids', async () => {
    const executeBodies: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith('/api/admin/translations?')) {
        return jsonResponse({ tasks: makeTasks(50), total: 135 })
      }

      if (url === '/api/admin/translations/execute') {
        const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
        executeBodies.push(body)
        if (executeBodies.length === 1) {
          return jsonResponse({ total: 100, success: 96, failed: 2, skipped: 2 })
        }
        return jsonResponse({ total: 35, success: 33, failed: 1, skipped: 1 })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })
    global.fetch = fetchMock as any

    const { result } = renderHook(() =>
      useTranslationBatchExecution({
        entityType: 'article',
        targetLanguage: 'ja',
        q: 'tokyo',
        toast,
        reloadAll,
      })
    )

    act(() => {
      result.current.setShowBatchModal(true)
    })

    await waitFor(() => {
      expect(result.current.batchTotal).toBe(135)
    })

    act(() => {
      result.current.setBatchScopeMode('all_matching_filter')
    })

    await act(async () => {
      await result.current.handleBatchSubmit()
    })

    await waitFor(() => {
      expect(reloadAll).toHaveBeenCalledTimes(1)
    })

    expect(executeBodies).toHaveLength(2)
    expect(executeBodies[0]).toMatchObject({
      entityType: 'article',
      targetLanguage: 'ja',
      q: 'tokyo',
      limit: 100,
      statusScope: 'pending',
      concurrency: 4,
    })
    expect(executeBodies[0].taskIds).toBeUndefined()
    expect(executeBodies[1]).toMatchObject({
      entityType: 'article',
      targetLanguage: 'ja',
      q: 'tokyo',
      limit: 100,
      statusScope: 'pending',
      concurrency: 4,
    })
    expect(toast.success).toHaveBeenCalledWith(
      '已执行 135 个，成功 129 个，失败 3 个，跳过 3 个'
    )
  })
})
