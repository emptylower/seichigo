import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import MapDialogs from '@/features/map/anitabi/MapDialogs'

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
    showCheckInCard: false,
    setShowCheckInCard: vi.fn(),
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
  it('retries preview images instead of leaving the dialog on a dead blank image', () => {
    render(<MapDialogs {...createProps()} />)

    const lowResFallback = document.querySelector('img[aria-hidden="true"]') as HTMLImageElement | null
    expect(lowResFallback?.src).toBe(
      'https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?plan=h160',
    )

    const img = screen.getByAltText('JR水道橋駅 西口') as HTMLImageElement
    expect(img.src).toBe('https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80')

    fireEvent.error(img)
    const retried = screen.getByAltText('JR水道橋駅 西口') as HTMLImageElement
    expect(retried.src).toBe(
      'https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80&_retry=1',
    )

    fireEvent.error(retried)
    const proxied = screen.getByAltText('JR水道橋駅 西口') as HTMLImageElement
    expect(decodeURIComponent(proxied.src)).toContain(
      '/api/anitabi/image-render?url=https://image.anitabi.cn/points/217249/db2c913d_1754363336601.jpg?w=640&q=80',
    )
  })
})
