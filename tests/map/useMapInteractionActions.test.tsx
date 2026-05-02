import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('maplibre-gl', () => ({
  default: {},
}))

import { useMapInteractionActions } from '@/features/map/anitabi/useMapInteractionActions'

function buildBaseDeps(overrides: Partial<Parameters<typeof useMapInteractionActions>[0]> = {}) {
  const startRequest = vi.fn(() => ({ requestUrl: 'rsp://req', requestId: 'req-1' }))
  const finishRequest = vi.fn()
  const mapImageDiagManagerRef = { current: { startRequest, finishRequest } }
  return {
    locateHint: null,
    setLocateHint: vi.fn(),
    setIsDesktop: vi.fn(),
    setMobilePanelOpen: vi.fn(),
    mapRef: { current: null },
    isDesktop: false,
    mobilePanelOpen: false,
    selectedPoint: null,
    queryInput: '',
    setQuery: vi.fn(),
    cards: [],
    openBangumi: vi.fn(async () => {}),
    selectedPointPanorama: null,
    setPanoramaError: vi.fn(),
    setMapViewMode: vi.fn(),
    isDesktopRef: { current: false },
    setMobilePointPopupOpen: vi.fn(),
    mapImageDiagManagerRef,
    label: {
      noImage: '',
      previewImage: '',
      saveOriginalFailed: '',
      locateInsecure: '',
      locateUnavailable: '',
      locateDenied: '',
      locateTimeout: '',
      locateFailed: '',
      mapNotReady: '',
      located: '',
      title: '',
      shareCopied: '',
      shareFailed: '',
      shareManualCopy: '',
      signInToPointPool: '',
      addToPointPoolFailed: '',
      pointPoolGuide: '',
      addToPointPoolSuccess: '',
      signInToRouteBook: '',
      addToRouteBookFailed: '',
      routeBookPickOne: '',
      addToRouteBookSuccess: '',
      routeBookCreatedAndAdded: '',
    },
    imagePreview: null,
    setImagePreview: vi.fn(),
    setImageSaving: vi.fn(),
    setImageSaveError: vi.fn(),
    setLocating: vi.fn(),
    imageSaving: false,
    parseContentDispositionFilename: vi.fn(() => null),
    sanitizeDownloadFileNameBase: vi.fn((value?: string | null) => value || 'image'),
    extensionFromMimeType: vi.fn(() => '.jpg'),
    mapZoom: 0,
    autoPanoramaDismissedRef: { current: false },
    userMarkerRef: { current: null },
    focusGeo: vi.fn(),
    resolveLocateZoom: vi.fn(() => 10),
    setUserLocation: vi.fn(),
    writeStoredUserLocation: vi.fn(),
    mapReady: false,
    userLocation: null,
    parsed: { hasViewport: false },
    autoLocateAttemptedRef: { current: false },
    readStoredUserLocationRaw: vi.fn(() => null),
    queryGeolocationPermissionState: vi.fn(async () => null),
    setTab: vi.fn(),
    setLocationDialogOpen: vi.fn(),
    syncUrlRef: { current: vi.fn() },
    getApiErrorMessage: vi.fn(() => null),
    loadMe: vi.fn(async () => {}),
    hasSeenPointPoolHint: vi.fn(() => true),
    markPointPoolHintSeen: vi.fn(),
    setRouteBookPickerLoading: vi.fn(),
    setRouteBookPickerError: vi.fn(),
    setRouteBookPickerOpen: vi.fn(),
    setRouteBookItems: vi.fn(),
    isRouteBookListItem: vi.fn(() => true),
    setRouteBookPickerSaving: vi.fn(),
    routeBookTitleDraft: '',
    getRouteBookIdFromCreateResponse: vi.fn(() => null),
    setRouteBookTitleDraft: vi.fn(),
    setDetailCardMode: vi.fn(),
    setSelectedPointId: vi.fn(),
    selectedPointId: 'p-1',
    tab: 'nearby',
    ...overrides,
    startRequest,
    finishRequest,
  } as any
}

describe('useMapInteractionActions window-excerpt diag callbacks', () => {
  it('startRequest records slotType=dom-image, owner=dom-image, requestedCandidateUrl, and evidence.view=window-excerpt', () => {
    const deps = buildBaseDeps()
    const { result } = renderHook(() => useMapInteractionActions(deps))
    const handle = result.current.onWindowExcerptDiagnosticRequestStart({
      slotKey: 'dom-window-excerpt-pt-42',
      surface: 'nearby',
      requestedCandidateUrl: 'https://image.anitabi.cn/bangumi/42.jpg',
      candidateIndex: 0,
      candidateCount: 3,
      reuseChain: false,
      queueWaitMs: 17,
    })
    expect(deps.startRequest).toHaveBeenCalledWith(expect.objectContaining({
      surface: 'nearby',
      slotKey: 'dom-window-excerpt-pt-42',
      slotType: 'dom-image',
      owner: 'dom-image',
      requestedCandidateUrl: 'https://image.anitabi.cn/bangumi/42.jpg',
      candidateIndex: 0,
      candidateCount: 3,
      reuseChain: false,
      evidence: expect.objectContaining({ view: 'window-excerpt', queue_wait_ms: 17 }),
    }))
    expect(handle).toEqual({ requestUrl: 'rsp://req', requestId: 'req-1' })
  })

  it('defaults queue_wait_ms to 0 when queueWaitMs is omitted', () => {
    const deps = buildBaseDeps()
    const { result } = renderHook(() => useMapInteractionActions(deps))

    result.current.onWindowExcerptDiagnosticRequestStart({
      slotKey: 'dom-window-excerpt-pt-42',
      surface: 'nearby',
      requestedCandidateUrl: 'https://image.anitabi.cn/bangumi/42.jpg',
      candidateIndex: 0,
      candidateCount: 1,
      reuseChain: false,
    })

    expect(deps.startRequest).toHaveBeenCalledWith(expect.objectContaining({
      evidence: expect.objectContaining({ view: 'window-excerpt', queue_wait_ms: 0 }),
    }))
  })

  it('finishRequest forwards handle, terminalState, displayOutcome, finalUrl, outcome, and tags evidence', () => {
    const deps = buildBaseDeps()
    const { result } = renderHook(() => useMapInteractionActions(deps))
    result.current.onWindowExcerptDiagnosticRequestTerminal({
      handle: { requestUrl: 'rsp://req', requestId: 'req-1' },
      terminalState: 'succeeded',
      displayOutcome: 'visible',
      finalUrl: 'https://image.anitabi.cn/bangumi/42.jpg',
      chainTerminal: true,
      outcome: 'window-excerpt-visible',
    })
    expect(deps.finishRequest).toHaveBeenCalledWith(
      { requestUrl: 'rsp://req', requestId: 'req-1' },
      expect.objectContaining({
        terminalState: 'succeeded',
        displayOutcome: 'visible',
        finalUrl: 'https://image.anitabi.cn/bangumi/42.jpg',
        chainTerminal: true,
        outcome: 'window-excerpt-visible',
        evidence: expect.objectContaining({ view: 'window-excerpt' }),
      }),
    )
  })

  it('returns null from startRequest when manager is not available', () => {
    const deps = buildBaseDeps({
      mapImageDiagManagerRef: { current: null },
    } as any)
    const { result } = renderHook(() => useMapInteractionActions(deps))
    const handle = result.current.onWindowExcerptDiagnosticRequestStart({
      slotKey: 'dom-window-excerpt-pt-42',
      surface: 'nearby',
      requestedCandidateUrl: 'u',
      candidateIndex: 0,
      candidateCount: 1,
      reuseChain: false,
    })
    expect(handle).toBeNull()
  })
})
