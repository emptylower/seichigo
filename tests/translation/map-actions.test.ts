import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTranslationsMapActions } from '@/app/(authed)/admin/translations/mapActions'

function jsonResponse(data: unknown, ok = true) {
  return Promise.resolve({
    ok,
    json: async () => data,
  })
}

function createDeps(overrides: Record<string, unknown> = {}) {
  return {
    targetLanguage: 'ja',
    bangumiBackfillCursor: 'bangumi-cursor',
    pointBackfillCursor: 'point-cursor',
    entityTypeLabels: {
      anitabi_bangumi: '作品',
      anitabi_point: '点位',
    },
    askForConfirm: vi.fn(async () => true),
    toast: {
      success: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    },
    setMapOpsLoading: vi.fn(),
    setMapOpsMessage: vi.fn(),
    setBangumiBackfillCursor: vi.fn(),
    setPointBackfillCursor: vi.fn(),
    setSampleApproving: vi.fn(),
    setApproveAllReadyRunning: vi.fn(),
    beginMapOpsProgress: vi.fn(),
    patchMapOpsProgress: vi.fn(),
    reloadAll: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('createTranslationsMapActions', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('continues one-key map advance until backend returns done', async () => {
    const deps = createDeps()
    const fetchMock = vi
      .fn()
      .mockImplementationOnce((_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || '{}'))
        expect(body).toMatchObject({
          action: 'advance_one_key',
          targetLanguage: 'ja',
          maxRounds: 1,
          continuation: {
            bangumiBackfillCursor: 'bangumi-cursor',
            pointBackfillCursor: 'point-cursor',
          },
        })

        return jsonResponse({
          ok: true,
          action: 'advance_one_key',
          done: false,
          message: '继续推进',
          bangumiBackfillCursor: 'b-1',
          pointBackfillCursor: 'p-1',
          continuation: {
            processed: 12,
            success: 10,
            failed: 1,
            reclaimed: 1,
            skipped: 0,
            errors: [],
          },
          snapshot: {
            processed: 12,
            success: 10,
            failed: 1,
            reclaimed: 1,
            skipped: 0,
            currentStep: 12,
            totalSteps: 100,
            detail: '继续推进',
            errors: [],
            oneKey: null,
          },
        })
      })
      .mockImplementationOnce((_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || '{}'))
        expect(body).toMatchObject({
          action: 'advance_one_key',
          targetLanguage: 'ja',
          maxRounds: 1,
          continuation: {
            processed: 12,
            success: 10,
            failed: 1,
            reclaimed: 1,
            skipped: 0,
            errors: [],
          },
        })

        return jsonResponse({
          ok: true,
          action: 'advance_one_key',
          done: true,
          message: '地图队列已全部处理完成',
          bangumiBackfillCursor: null,
          pointBackfillCursor: null,
          continuation: null,
          snapshot: {
            processed: 20,
            success: 17,
            failed: 2,
            reclaimed: 1,
            skipped: 1,
            currentStep: 20,
            totalSteps: 100,
            detail: '地图队列已全部处理完成',
            errors: [],
            oneKey: null,
          },
        })
      })
    global.fetch = fetchMock as any

    const actions = createTranslationsMapActions(deps)
    await actions.handleOneKeyAdvanceMapQueue()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(deps.setBangumiBackfillCursor).toHaveBeenLastCalledWith(null)
    expect(deps.setPointBackfillCursor).toHaveBeenLastCalledWith(null)
    expect(deps.reloadAll).toHaveBeenCalledTimes(1)
    expect(deps.toast.success).toHaveBeenCalledWith('地图队列已全部处理完成')
    expect(deps.patchMapOpsProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: '一键推进地图队列',
        running: false,
        processed: 20,
        success: 17,
      })
    )
  })

  it('does not call approve-all endpoint when confirmation is rejected', async () => {
    const deps = createDeps({
      askForConfirm: vi.fn(async () => false),
    })
    const fetchMock = vi.fn()
    global.fetch = fetchMock as any

    const actions = createTranslationsMapActions(deps)
    await actions.approveAllReadyTasks()

    expect(deps.askForConfirm).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(deps.setApproveAllReadyRunning).not.toHaveBeenCalled()
  })
})
