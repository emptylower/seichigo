import { useCallback, useEffect } from 'react'
import maplibregl from 'maplibre-gl'
import type { UserLocation } from './shared'
import {
  DESKTOP_BREAKPOINT,
  LOCATION_DIALOG_DISMISSED_KEY,
  PANORAMA_TRIGGER_ZOOM,
} from './shared'

export function useMapInteractionActions(ctx: any) {
  const {
    locateHint,
    setLocateHint,
    setIsDesktop,
    setMobilePanelOpen,
    mapRef,
    isDesktop,
    mobilePanelOpen,
    selectedPoint,
    queryInput,
    setQuery,
    cards,
    openBangumi,
    selectedPointPanorama,
    setPanoramaError,
    setMapViewMode,
    isDesktopRef,
    setMobilePointPopupOpen,
    setImageSaving,
    setImageSaveError,
    setImagePreview,
    setLocating,
    label,
    imagePreview,
    imageSaving,
    parseContentDispositionFilename,
    sanitizeDownloadFileNameBase,
    extensionFromMimeType,
    mapZoom,
    autoPanoramaDismissedRef,
    userMarkerRef,
    focusGeo,
    resolveLocateZoom,
    setUserLocation,
    writeStoredUserLocation,
    mapReady,
    userLocation,
    parsed,
    autoLocateAttemptedRef,
    readStoredUserLocationRaw,
    queryGeolocationPermissionState,
    setTab,
    setLocationDialogOpen,
    syncUrlRef,
    getApiErrorMessage,
    loadMe,
    hasSeenPointPoolHint,
    markPointPoolHintSeen,
    setRouteBookPickerLoading,
    setRouteBookPickerError,
    setRouteBookPickerOpen,
    setRouteBookItems,
    isRouteBookListItem,
    setRouteBookPickerSaving,
    routeBookTitleDraft,
    getRouteBookIdFromCreateResponse,
    setRouteBookTitleDraft,
    setDetailCardMode,
    setSelectedPointId,
  } = ctx

  useEffect(() => {
    if (!locateHint) return
    const timer = window.setTimeout(() => {
      setLocateHint(null)
    }, 6000)
    return () => window.clearTimeout(timer)
  }, [locateHint])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleResize = () => {
      const desktop = window.innerWidth >= DESKTOP_BREAKPOINT
      setIsDesktop(desktop)
      if (desktop) {
        setMobilePanelOpen(false)
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const rafId = window.requestAnimationFrame(() => {
      map.resize()
    })
    return () => window.cancelAnimationFrame(rafId)
  }, [isDesktop, mobilePanelOpen])

  useEffect(() => {
    if (isDesktop) {
      setMobilePointPopupOpen(false)
    }
  }, [isDesktop])

  useEffect(() => {
    if (!selectedPoint) {
      setMobilePointPopupOpen(false)
    }
  }, [selectedPoint])

  const onSubmitQuery = useCallback(() => {
    setQuery(queryInput.trim())
    // Keep searchOpen so the dropdown results remain visible for the user to pick from
  }, [queryInput])

  const onRandom = useCallback(() => {
    if (!cards.length) return
    const picked = cards[Math.floor(Math.random() * cards.length)]
    if (!picked) return
    openBangumi(picked.id).catch(() => null)
  }, [cards, openBangumi])

  const enterPanorama = useCallback(() => {
    if (!selectedPointPanorama) return
    setPanoramaError(null)
    setMapViewMode('panorama')
    if (!isDesktopRef.current) {
      setMobilePointPopupOpen(false)
    }
  }, [selectedPointPanorama])

  const openImagePreview = useCallback((imageUrl: string | null | undefined, pointName: string, saveUrl?: string | null) => {
    const src = String(imageUrl || '').trim()
    if (!src) return
    const saveTarget = String(saveUrl || '').trim() || src
    setImageSaving(false)
    setImageSaveError(null)
    setImagePreview({ src, name: pointName, saveUrl: saveTarget })
  }, [])

  const onImagePreviewOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setImagePreview(null)
      setImageSaving(false)
      setImageSaveError(null)
    }
  }, [])

  const renderPointImage = useCallback(
    (imageUrl: string | null | undefined, pointName: string, saveUrl?: string | null, eager = false) => {
      const src = String(imageUrl || '').trim()
      if (!src) {
        return (
          <div className="grid h-40 w-full place-items-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
            {label.noImage}
          </div>
        )
      }

      return (
        <button
          type="button"
          className="group relative block h-40 w-full overflow-hidden rounded-md"
          onClick={() => openImagePreview(src, pointName, saveUrl)}
          title={label.previewImage}
          aria-label={label.previewImage}
        >
          <img
            src={src}
            alt={pointName}
            width={640}
            height={360}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.01]"
            loading={eager ? 'eager' : 'lazy'}
            fetchPriority={eager ? 'high' : 'auto'}
            decoding="async"
          />
          <span className="pointer-events-none absolute inset-x-2 bottom-2 rounded bg-black/60 px-2 py-0.5 text-[11px] text-white">
            {label.previewImage}
          </span>
        </button>
      )
    },
    [label.noImage, label.previewImage, openImagePreview]
  )

  const saveOriginalImage = useCallback(async () => {
    if (!imagePreview?.saveUrl || imageSaving) return

    setImageSaveError(null)
    setImageSaving(true)

    try {
      const params = new URLSearchParams()
      params.set('url', imagePreview.saveUrl)
      if (imagePreview.name) params.set('name', imagePreview.name)

      const res = await fetch(`/api/anitabi/image-download?${params.toString()}`)
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: unknown } | null
        const msg = String(data?.error || '').trim()
        throw new Error(msg || 'download_failed')
      }

      const blob = await res.blob()
      if (!blob.size) {
        throw new Error('empty_file')
      }

      const hintedName = parseContentDispositionFilename(res.headers.get('content-disposition'))
      const fallbackBase = sanitizeDownloadFileNameBase(imagePreview.name)
      const fallbackName = `${fallbackBase}${extensionFromMimeType(blob.type)}`
      const fileName = hintedName || fallbackName

      const objectUrl = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = fileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => {
        window.URL.revokeObjectURL(objectUrl)
      }, 1200)
    } catch (err) {
      const msg = String((err as Error)?.message || '').trim()
      setImageSaveError(msg && msg !== 'download_failed' ? msg : label.saveOriginalFailed)
    } finally {
      setImageSaving(false)
    }
  }, [imagePreview, imageSaving, label.saveOriginalFailed])

  const exitPanorama = useCallback(() => {
    if (mapZoom >= PANORAMA_TRIGGER_ZOOM) {
      autoPanoramaDismissedRef.current = true
    }
    setPanoramaError(null)
    setMapViewMode('map')
  }, [mapZoom])

  const paintUserMarker = useCallback((lng: number, lat: number) => {
    const map = mapRef.current
    if (!map) return

    if (!userMarkerRef.current) {
      const el = document.createElement('div')
      el.style.width = '16px'
      el.style.height = '16px'
      el.style.borderRadius = '999px'
      el.style.background = '#2563eb'
      el.style.border = '2px solid white'
      el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.35)'
      userMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map)
      return
    }

    userMarkerRef.current.setLngLat([lng, lat])
  }, [])

  const locateUser = useCallback((options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent)
    if (typeof window === 'undefined') return
    if (!window.isSecureContext) {
      if (!silent) setLocateHint(label.locateInsecure)
      return
    }

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      if (!silent) setLocateHint(label.locateUnavailable)
      return
    }

    setLocating(true)
    if (!silent) setLocateHint(null)

    const resolveFailure = (error: GeolocationPositionError) => {
      setLocating(false)
      if (silent) return
      if (error.code === error.PERMISSION_DENIED) {
        setLocateHint(label.locateDenied)
      } else if (error.code === error.TIMEOUT) {
        setLocateHint(label.locateTimeout)
      } else if (error.code === error.POSITION_UNAVAILABLE) {
        setLocateHint(label.locateUnavailable)
      } else {
        setLocateHint(label.locateFailed)
      }
    }

    const resolveSuccess = (position: GeolocationPosition) => {
      const map = mapRef.current
      if (!map) {
        setLocating(false)
        if (!silent) setLocateHint(label.mapNotReady)
        return
      }

      const { latitude, longitude, accuracy } = position.coords
      const roundedAccuracy = Number.isFinite(accuracy) ? Math.round(accuracy) : null
      const zoom = resolveLocateZoom(roundedAccuracy)
      const nextLocation: UserLocation = {
        lat: latitude,
        lng: longitude,
        accuracy: roundedAccuracy,
      }

      setUserLocation(nextLocation)
      writeStoredUserLocation(nextLocation)
      focusGeo([latitude, longitude], zoom, false)
      paintUserMarker(longitude, latitude)
      setLocating(false)
      if (!silent) {
        setLocateHint(roundedAccuracy != null ? `${label.located} (±${roundedAccuracy}m)` : label.located)
      }
    }

    const resolveError = (error: GeolocationPositionError, highAccuracy: boolean) => {
      if (highAccuracy && error.code !== error.PERMISSION_DENIED) {
        navigator.geolocation.getCurrentPosition(
          resolveSuccess,
          (fallbackError) => resolveFailure(fallbackError),
          {
            enableHighAccuracy: false,
            timeout: 10000,
            maximumAge: 300000,
          }
        )
        return
      }
      resolveFailure(error)
    }

    navigator.geolocation.getCurrentPosition(
      resolveSuccess,
      (error) => resolveError(error, true),
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    )
  }, [focusGeo, label.locateDenied, label.locateFailed, label.locateInsecure, label.locateTimeout, label.locateUnavailable, label.located, label.mapNotReady, paintUserMarker])

  const onLocate = useCallback(() => {
    locateUser()
  }, [locateUser])

  useEffect(() => {
    if (!mapReady || !userLocation) return
    paintUserMarker(userLocation.lng, userLocation.lat)
  }, [mapReady, paintUserMarker, userLocation])

  useEffect(() => {
    if (!mapReady) return
    if (parsed.hasViewport) return
    if (autoLocateAttemptedRef.current) return
    autoLocateAttemptedRef.current = true

    // Use cached location for instant initial display
    const cachedLocation = readStoredUserLocationRaw()
    if (cachedLocation) {
      focusGeo([cachedLocation.lat, cachedLocation.lng], resolveLocateZoom(cachedLocation.accuracy), false)
    }

    // Always fetch fresh location when permission is granted
    let canceled = false
    queryGeolocationPermissionState()
      .then((permissionState: PermissionState | null) => {
        if (canceled) return
        if (permissionState === 'granted') {
          locateUser({ silent: true })
        }
      })
      .catch(() => null)

    return () => {
      canceled = true
    }
  }, [focusGeo, locateUser, mapReady, parsed.hasViewport])

  // Location permission dialog for first-visit users
  useEffect(() => {
    if (!mapReady) return
    if (parsed.hasViewport) return

    let canceled = false
    queryGeolocationPermissionState()
      .then((permissionState: PermissionState | null) => {
        if (canceled) return
        if (permissionState === 'granted') {
          setTab('nearby')
          return
        }
        if (permissionState === 'denied') {
          setTab('latest')
          return
        }
        // permissionState is 'prompt' or null (API not supported)
        try {
          if (window.sessionStorage.getItem(LOCATION_DIALOG_DISMISSED_KEY) === '1') return
        } catch {
          // sessionStorage unavailable
        }
        setTab('latest')
        setLocationDialogOpen(true)
      })
      .catch(() => null)

    return () => {
      canceled = true
    }
  }, [mapReady, parsed.hasViewport])

  const onShare = useCallback(async () => {
    if (typeof window === 'undefined') return
    syncUrlRef.current()
    const href = window.location.href
    if (!isDesktop && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: label.title,
          url: href,
        })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(href)
        setLocateHint(label.shareCopied)
        return
      } catch {
        // fall through
      }
    }

    try {
      const textarea = document.createElement('textarea')
      textarea.value = href
      textarea.setAttribute('readonly', 'true')
      textarea.style.position = 'fixed'
      textarea.style.top = '-9999px'
      textarea.style.left = '-9999px'
      document.body.appendChild(textarea)
      textarea.select()
      textarea.setSelectionRange(0, textarea.value.length)
      const copied = document.execCommand('copy')
      document.body.removeChild(textarea)
      if (copied) {
        setLocateHint(label.shareCopied)
        return
      }
    } catch {
      // ignore
    }

    setLocateHint(label.shareFailed)
    window.prompt(label.shareManualCopy, href)
  }, [isDesktop, label.shareCopied, label.shareFailed, label.shareManualCopy, label.title])

  const addPointToPointPool = useCallback(
    async (pointId: string) => {
      try {
        const res = await fetch('/api/me/point-pool', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pointId }),
        })
        const json = await res.json().catch(() => ({}))
        if (res.status === 401) {
          if (window.confirm(label.signInToPointPool)) {
            window.location.href = `/auth/signin?callbackUrl=${encodeURIComponent(window.location.href)}`
          }
          return
        }
        if (!res.ok) {
          setLocateHint(getApiErrorMessage(json) || label.addToPointPoolFailed)
          return
        }

        await loadMe()
        if (!hasSeenPointPoolHint()) {
          markPointPoolHintSeen()
          setLocateHint(label.pointPoolGuide)
          return
        }

        setLocateHint(label.addToPointPoolSuccess)
      } catch {
        setLocateHint(label.addToPointPoolFailed)
      }
    },
    [
      label.addToPointPoolFailed,
      label.addToPointPoolSuccess,
      label.pointPoolGuide,
      label.signInToPointPool,
      loadMe,
    ]
  )

  const redirectToSignInForRouteBook = useCallback(() => {
    if (typeof window === 'undefined') return
    if (!window.confirm(label.signInToRouteBook)) return
    window.location.href = `/auth/signin?callbackUrl=${encodeURIComponent(window.location.href)}`
  }, [label.signInToRouteBook])

  const loadRouteBooks = useCallback(async () => {
    setRouteBookPickerLoading(true)
    setRouteBookPickerError(null)

    try {
      const res = await fetch('/api/me/routebooks', { method: 'GET' })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) {
        setRouteBookPickerOpen(false)
        redirectToSignInForRouteBook()
        return
      }
      if (!res.ok) {
        setRouteBookPickerError(getApiErrorMessage(data) || label.addToRouteBookFailed)
        return
      }

      const rows = Array.isArray((data as { items?: unknown[] }).items)
        ? (data as { items: unknown[] }).items.filter(isRouteBookListItem)
        : []
      setRouteBookItems(rows)
    } catch {
      setRouteBookPickerError(label.addToRouteBookFailed)
    } finally {
      setRouteBookPickerLoading(false)
    }
  }, [label.addToRouteBookFailed, redirectToSignInForRouteBook])

  const openRouteBookPicker = useCallback(() => {
    if (!selectedPoint) {
      setLocateHint(label.routeBookPickOne)
      return
    }
    setRouteBookPickerOpen(true)
    setRouteBookTitleDraft('')
    void loadRouteBooks()
  }, [label.routeBookPickOne, loadRouteBooks, selectedPoint])

  const addSelectedPointToRouteBook = useCallback(
    async (routeBookId: string) => {
      if (!selectedPoint) return
      setRouteBookPickerSaving(true)
      setRouteBookPickerError(null)
      try {
        const res = await fetch(`/api/me/routebooks/${routeBookId}/points`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pointId: selectedPoint.id }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.status === 401) {
          setRouteBookPickerOpen(false)
          redirectToSignInForRouteBook()
          return
        }
        if (!res.ok) {
          setRouteBookPickerError(getApiErrorMessage(data) || label.addToRouteBookFailed)
          return
        }
        setLocateHint(label.addToRouteBookSuccess)
        setRouteBookPickerOpen(false)
      } catch {
        setRouteBookPickerError(label.addToRouteBookFailed)
      } finally {
        setRouteBookPickerSaving(false)
      }
    },
    [label.addToRouteBookFailed, label.addToRouteBookSuccess, redirectToSignInForRouteBook, selectedPoint]
  )

  const createRouteBookAndAddPoint = useCallback(async () => {
    const title = routeBookTitleDraft.trim()
    if (!title || !selectedPoint) return

    setRouteBookPickerSaving(true)
    setRouteBookPickerError(null)

    try {
      const createRes = await fetch('/api/me/routebooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      const createData = await createRes.json().catch(() => ({}))
      if (createRes.status === 401) {
        setRouteBookPickerOpen(false)
        redirectToSignInForRouteBook()
        return
      }
      if (!createRes.ok) {
        setRouteBookPickerError(getApiErrorMessage(createData) || label.addToRouteBookFailed)
        return
      }

      const createdRouteBookId = getRouteBookIdFromCreateResponse(createData)
      if (!createdRouteBookId) {
        setRouteBookPickerError(label.addToRouteBookFailed)
        return
      }

      const addRes = await fetch(`/api/me/routebooks/${createdRouteBookId}/points`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pointId: selectedPoint.id }),
      })
      const addData = await addRes.json().catch(() => ({}))
      if (!addRes.ok) {
        setRouteBookPickerError(getApiErrorMessage(addData) || label.addToRouteBookFailed)
        return
      }

      setLocateHint(label.routeBookCreatedAndAdded)
      setRouteBookPickerOpen(false)
      setRouteBookTitleDraft('')
    } catch {
      setRouteBookPickerError(label.addToRouteBookFailed)
    } finally {
      setRouteBookPickerSaving(false)
    }
  }, [label.addToRouteBookFailed, label.routeBookCreatedAndAdded, redirectToSignInForRouteBook, routeBookTitleDraft, selectedPoint])

  const switchToBangumiDetail = useCallback(() => {
    setDetailCardMode('bangumi')
    setSelectedPointId(null)
    setMobilePointPopupOpen(false)
    setMapViewMode('map')
  }, [])

  return {
    onSubmitQuery,
    onRandom,
    enterPanorama,
    onImagePreviewOpenChange,
    renderPointImage,
    saveOriginalImage,
    exitPanorama,
    onLocate,
    locateUser,
    onShare,
    addPointToPointPool,
    openRouteBookPicker,
    addSelectedPointToRouteBook,
    createRouteBookAndAddPoint,
    switchToBangumiDetail,
  }
}
