import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MapDialogs from '@/features/map/anitabi/MapDialogs'
import { resetDegradedMapImageHostsForTest } from '@/components/map/utils/mapImageHostPolicy'
import { resetMapImageRequestSchedulerForTest } from '@/features/map/anitabi/mapImageRequestScheduler'

vi.mock('next-auth/react', () => ({
  useSession: vi.fn(() => ({ data: null, status: 'unauthenticated' })),
}))

beforeEach(() => {
  resetDegradedMapImageHostsForTest()
  resetMapImageRequestSchedulerForTest()
})

function createProps() {
  return {
    locale: 'ja' as const,
    label: {
      previewImage: '原画像を表示',
      savingOriginal: '保存中',
      saveOriginal: '元画像をダウンロード',
      close: '閉じる',
      routeBookSelectTitle: 'select',
      routeBookPickOne: 'pick',
      routeBookLoading: 'loading',
      routeBookEmpty: 'empty',
      routeBookCreatePlaceholder: 'placeholder',
      loading: 'loading',
      routeBookCreateAndAdd: 'create',
      share: '共有',
    } as any,
    detail: null,
    selectedPoint: null,
    showQuickPilgrimage: false,
    quickPilgrimageStates: {},
    setShowQuickPilgrimage: vi.fn(),
    onQuickPilgrimageStatesUpdated: vi.fn(),
    routeBookPickerOpen: false,
    setRouteBookPickerOpen: vi.fn(),
    routeBookPickerLoading: false,
    routeBookItems: [],
    routeBookPickerSaving: false,
    addSelectedPointToRouteBook: vi.fn(async () => {}),
    routeBookTitleDraft: '',
    setRouteBookTitleDraft: vi.fn(),
    createRouteBookAndAddPoint: vi.fn(async () => {}),
    routeBookPickerError: null,
    imagePreview: {
      src: 'https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80',
      name: 'JR水道橋駅 西口',
      saveUrl: 'https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg',
      fallbackSrc: 'https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?plan=h160',
    },
    onImagePreviewOpenChange: vi.fn(),
    imageSaving: false,
    saveOriginalImage: vi.fn(async () => {}),
    imageSaveError: null,
    showSharePanel: false,
    setShowSharePanel: vi.fn(),
    showRouteBookCard: false,
    setShowRouteBookCard: vi.fn(),
    showComparisonGenerator: false,
    setShowComparisonGenerator: vi.fn(),
    comparisonImageUrl: null,
    selectedPointImagePreviewUrl: null,
    selectedPointImageDownloadUrl: null,
    totalRouteDistance: '0km',
    routeBookPoints: [],
    checkedInThumbnails: [],
    onComparisonSuccess: vi.fn(),
    locationDialogOpen: false,
    setLocationDialogOpen: vi.fn(),
    onLocationDialogGrant: vi.fn(),
  }
}

describe('MapDialogs image preview', () => {
  it('retries preview images instead of leaving the dialog on a dead blank image', async () => {
    render(<MapDialogs {...createProps()} />)

    const lowResFallback = document.querySelector('img[aria-hidden="true"]') as HTMLImageElement | null
    expect(lowResFallback?.src).toBe(
      'https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?plan=h160',
    )

    const img = await screen.findByAltText('JR水道橋駅 西口') as HTMLImageElement
    expect(decodeURIComponent(decodeURIComponent(img.src))).toContain(
      '/api/anitabi/image-render?url=https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80',
    )

    fireEvent.error(img)
    const retried = await screen.findByAltText('JR水道橋駅 西口') as HTMLImageElement
    expect(decodeURIComponent(decodeURIComponent(retried.src))).toContain(
      '/api/anitabi/image-render?url=https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80&_retry=1',
    )

    fireEvent.error(retried)
    const proxied = await screen.findByAltText('JR水道橋駅 西口') as HTMLImageElement
    expect(decodeURIComponent(decodeURIComponent(proxied.src))).toContain(
      '/api/anitabi/image-render?url=https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80&_retry=1',
    )
  })

  it('forwards preview diagnostics into the resilient image path when configured', async () => {
    const onPreviewDiagnosticRequestStart = vi.fn((input: any) => ({
      requestUrl: `${input.requestedCandidateUrl}?__mi_request=preview-1`,
      requestId: 'preview-1',
    }))
    const onPreviewDiagnosticRequestTerminal = vi.fn()

    render(
      <MapDialogs
        {...createProps()}
        imagePreview={{
          ...createProps().imagePreview,
          diagnosticSurface: 'map',
          diagnosticSlotKey: 'preview-217249',
        }}
        onPreviewDiagnosticRequestStart={onPreviewDiagnosticRequestStart}
        onPreviewDiagnosticRequestTerminal={onPreviewDiagnosticRequestTerminal}
      />
    )

    const img = await screen.findByAltText('JR水道橋駅 西口') as HTMLImageElement
    expect(onPreviewDiagnosticRequestStart).toHaveBeenCalledTimes(1)
    expect(onPreviewDiagnosticRequestStart.mock.calls[0]?.[0]).toMatchObject({
      slotKey: 'preview-217249',
      surface: 'map',
    })
    expect(img.getAttribute('src')).toContain('__mi_request=preview-1')

    fireEvent.load(img)
    expect(onPreviewDiagnosticRequestTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        handle: { requestId: 'preview-1', requestUrl: expect.stringContaining('__mi_request=preview-1') },
        terminalState: 'succeeded',
        displayOutcome: 'visible',
      }),
    )
  })
})

describe('MapDialogs 分享面板', () => {
  it('showSharePanel 打开时渲染分享面板标题', () => {
    render(
      <MapDialogs
        {...(createProps() as any)}
        showSharePanel
        detail={{ card: { id: 101, title: '君の名は。', city: '東京', cover: null }, points: [] } as any}
        selectedPoint={
          {
            id: '101:suga',
            bangumiId: 101,
            name: '須賀神社',
            nameZh: '须贺神社',
            note: null,
            geo: [35.6, 139.7],
            ep: '1',
            s: null,
            image: null,
            origin: null,
            originUrl: null,
            originLink: null,
            density: null,
            mark: null,
          } as any
        }
      />,
    )
    expect(screen.getByText('このスポットを共有')).toBeInTheDocument()
  })

  it('分享 Dialog 带 sr-only 的 Title 与 Description', () => {
    render(
      <MapDialogs
        {...(createProps() as any)}
        imagePreview={null}
        showSharePanel
        detail={{ card: { id: 101, title: '君の名は。', city: '東京', cover: null }, points: [] } as any}
        selectedPoint={
          {
            id: '101:suga',
            bangumiId: 101,
            name: '須賀神社',
            nameZh: '须贺神社',
            note: null,
            geo: [35.6, 139.7],
            ep: '1',
            s: null,
            image: null,
            origin: null,
            originUrl: null,
            originLink: null,
            density: null,
            mark: null,
          } as any
        }
      />,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAccessibleName('共有')
    expect(dialog).toHaveAccessibleDescription('須賀神社')
  })
})
