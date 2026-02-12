'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import type { SupportedLocale } from '@/lib/i18n/types'
import type { AnitabiBangumiCard, AnitabiBangumiDTO, AnitabiBootstrapDTO, AnitabiChangelogDTO, AnitabiMapTab } from '@/lib/anitabi/types'

type Props = {
  locale: SupportedLocale
}

type MeState = {
  favorites: Array<{ targetKey: string }>
  history: Array<{ targetKey: string }>
}

type UrlState = {
  b: number | null
  p: string | null
  lng: number
  lat: number
  z: number
  tab: AnitabiMapTab
  q: string
}

type SearchResult = {
  bangumi: AnitabiBangumiCard[]
  points: Array<{ id: string; bangumiId: number; name: string }>
  cities: string[]
}

const DEFAULT_VIEW = {
  lng: 139.767125,
  lat: 35.681236,
  z: 5,
}

const L: Record<SupportedLocale, Record<string, string>> = {
  zh: {
    title: '巡礼地图',
    searchPlaceholder: '城市、作品、地标',
    latest: '最新更新',
    recent: '近期新作',
    hot: '热门作品',
    random: '随机跳转作品',
    locate: '定位到我的位置',
    locating: '定位中…',
    located: '已定位',
    locateDenied: '定位权限被拒绝，请在浏览器中允许位置权限',
    locateTimeout: '定位超时，请重试',
    locateUnavailable: '当前设备不支持定位',
    locateInsecure: '定位需要 HTTPS 或 localhost 环境',
    locateFailed: '定位失败，请稍后重试',
    mapNotReady: '地图尚未就绪，请稍后再试',
    changelog: '更新记录',
    close: '关闭',
    loading: '加载中...',
    noData: '暂无可用数据',
    points: '地标',
    screenshots: '截图',
    share: '分享',
    openInGoogle: '谷歌导航',
    favorites: '收藏',
    selected: '当前作品',
    signInToFavorite: '登录后可收藏',
  },
  en: {
    title: 'Pilgrimage Map',
    searchPlaceholder: 'City, anime, or spot',
    latest: 'Latest Updates',
    recent: 'Recent Releases',
    hot: 'Trending',
    random: 'Random Anime',
    locate: 'Locate Me',
    locating: 'Locating…',
    located: 'Located',
    locateDenied: 'Location permission denied in browser settings',
    locateTimeout: 'Location timeout, please retry',
    locateUnavailable: 'Geolocation is unavailable on this device',
    locateInsecure: 'Geolocation requires HTTPS or localhost',
    locateFailed: 'Failed to locate, please retry later',
    mapNotReady: 'Map is not ready yet',
    changelog: 'Changelog',
    close: 'Close',
    loading: 'Loading...',
    noData: 'No data yet',
    points: 'Points',
    screenshots: 'Shots',
    share: 'Share',
    openInGoogle: 'Google Nav',
    favorites: 'Favorite',
    selected: 'Selected',
    signInToFavorite: 'Sign in to favorite',
  },
  ja: {
    title: '巡礼マップ',
    searchPlaceholder: '都市・作品・スポット',
    latest: '最新更新',
    recent: '新着作品',
    hot: '人気作品',
    random: 'ランダム作品',
    locate: '現在地',
    locating: '現在地を取得中…',
    located: '現在地を取得済み',
    locateDenied: '位置情報の権限が拒否されました。ブラウザ設定をご確認ください',
    locateTimeout: '位置情報の取得がタイムアウトしました',
    locateUnavailable: 'この端末では位置情報を利用できません',
    locateInsecure: '位置情報には HTTPS または localhost が必要です',
    locateFailed: '位置情報の取得に失敗しました',
    mapNotReady: '地図の初期化が未完了です',
    changelog: '更新履歴',
    close: '閉じる',
    loading: '読み込み中...',
    noData: 'データがありません',
    points: 'スポット',
    screenshots: '画像',
    share: '共有',
    openInGoogle: 'Google ナビ',
    favorites: 'お気に入り',
    selected: '選択中',
    signInToFavorite: 'ログインしてお気に入り',
  },
}

function parseUrlState(): UrlState {
  if (typeof window === 'undefined') {
    return {
      b: null,
      p: null,
      lng: DEFAULT_VIEW.lng,
      lat: DEFAULT_VIEW.lat,
      z: DEFAULT_VIEW.z,
      tab: 'latest',
      q: '',
    }
  }

  const params = new URLSearchParams(window.location.search)
  const b = Number(params.get('b'))
  const lng = Number(params.get('lng'))
  const lat = Number(params.get('lat'))
  const z = Number(params.get('z'))
  const tabRaw = params.get('tab')

  return {
    b: Number.isFinite(b) ? b : null,
    p: params.get('p') || null,
    lng: Number.isFinite(lng) ? lng : DEFAULT_VIEW.lng,
    lat: Number.isFinite(lat) ? lat : DEFAULT_VIEW.lat,
    z: Number.isFinite(z) ? z : DEFAULT_VIEW.z,
    tab: tabRaw === 'recent' || tabRaw === 'hot' ? tabRaw : 'latest',
    q: params.get('q') || '',
  }
}

function buildStyle(mode: 'street' | 'satellite'): maplibregl.StyleSpecification {
  if (mode === 'satellite') {
    return {
      version: 8,
      sources: {
        sat: {
          type: 'raster',
          tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: 'Tiles © Esri',
        },
      },
      layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
    }
  }

  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  }
}

function geoLink(point: { geo: [number, number] | null }): string | null {
  if (!point.geo) return null
  return `https://www.google.com/maps?q=${point.geo[0]},${point.geo[1]}`
}

function matchPointId(candidateId: string, pointId: string): boolean {
  if (candidateId === pointId) return true
  if (pointId.includes(':')) return false
  return candidateId.endsWith(`:${pointId}`)
}

export default function AnitabiMapPageClient({ locale }: Props) {
  const label = L[locale]

  const parsed = useMemo(() => parseUrlState(), [])

  const mapRootRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const userMarkerRef = useRef<maplibregl.Marker | null>(null)
  const syncUrlRef = useRef<() => void>(() => undefined)

  const [tab, setTab] = useState<AnitabiMapTab>(parsed.tab)
  const [queryInput, setQueryInput] = useState(parsed.q)
  const [query, setQuery] = useState(parsed.q)
  const [selectedCity, setSelectedCity] = useState('')
  const [selectedBangumiId, setSelectedBangumiId] = useState<number | null>(parsed.b)
  const [selectedPointId, setSelectedPointId] = useState<string | null>(parsed.p)
  const [styleMode, setStyleMode] = useState<'street' | 'satellite'>('street')
  const [changelogOpen, setChangelogOpen] = useState(false)

  const [bootstrap, setBootstrap] = useState<AnitabiBootstrapDTO | null>(null)
  const [cards, setCards] = useState<AnitabiBangumiCard[]>([])
  const [detail, setDetail] = useState<AnitabiBangumiDTO | null>(null)
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [searchResult, setSearchResult] = useState<SearchResult>({ bangumi: [], points: [], cities: [] })
  const [searchOpen, setSearchOpen] = useState(false)
  const [meState, setMeState] = useState<MeState | null>(null)
  const [meLoaded, setMeLoaded] = useState(false)
  const [locating, setLocating] = useState(false)
  const [locateHint, setLocateHint] = useState<string | null>(null)

  const selectedPoint = useMemo(() => {
    if (!detail || !selectedPointId) return null
    return detail.points.find((point) => matchPointId(point.id, selectedPointId)) || null
  }, [detail, selectedPointId])

  const favoriteSet = useMemo(() => {
    return new Set((meState?.favorites || []).map((row) => row.targetKey))
  }, [meState])

  const syncUrl = useCallback(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams()
    if (selectedBangumiId != null) params.set('b', String(selectedBangumiId))
    if (selectedPointId) params.set('p', selectedPointId)
    if (query) params.set('q', query)
    if (tab !== 'latest') params.set('tab', tab)

    const map = mapRef.current
    if (map) {
      const center = map.getCenter()
      params.set('lng', center.lng.toFixed(6))
      params.set('lat', center.lat.toFixed(6))
      params.set('z', map.getZoom().toFixed(2))
    }

    const next = params.toString()
    const href = `${window.location.pathname}${next ? `?${next}` : ''}`
    window.history.replaceState(null, '', href)
  }, [query, selectedBangumiId, selectedPointId, tab])

  useEffect(() => {
    syncUrlRef.current = syncUrl
  }, [syncUrl])

  const loadMe = useCallback(async () => {
    try {
      const res = await fetch(`/api/anitabi/me/state?locale=${encodeURIComponent(locale)}`, { method: 'GET' })
      if (res.status === 401) {
        setMeState(null)
        setMeLoaded(true)
        return
      }
      if (!res.ok) return
      const json = await res.json()
      setMeState({
        favorites: Array.isArray(json.favorites) ? json.favorites : [],
        history: Array.isArray(json.history) ? json.history : [],
      })
    } catch {
      // noop
    } finally {
      setMeLoaded(true)
    }
  }, [locale])

  const loadBootstrap = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('locale', locale)
      params.set('tab', tab)
      if (query) params.set('q', query)
      if (selectedCity) params.set('city', selectedCity)

      const res = await fetch(`/api/anitabi/bootstrap?${params.toString()}`, { method: 'GET' })
      if (!res.ok) throw new Error('Failed to load bootstrap')
      const json = (await res.json()) as AnitabiBootstrapDTO
      setBootstrap(json)
      setCards(json.cards)
    } finally {
      setLoading(false)
    }
  }, [locale, query, selectedCity, tab])

  const openBangumi = useCallback(
    async (id: number, pointId?: string | null) => {
      setSelectedBangumiId(id)
      setSelectedPointId(pointId || null)
      setDetailLoading(true)
      try {
        const res = await fetch(`/api/anitabi/bangumi/${id}?locale=${encodeURIComponent(locale)}`, { method: 'GET' })
        if (!res.ok) throw new Error('load detail failed')
        const json = (await res.json()) as AnitabiBangumiDTO
        setDetail(json)

        const map = mapRef.current
        if (map) {
          if (pointId) {
            const target = json.points.find((point) => matchPointId(point.id, pointId))
            if (target && target.id !== pointId) {
              setSelectedPointId(target.id)
            }
            if (target?.geo) {
              map.flyTo({ center: [target.geo[1], target.geo[0]], zoom: Math.max(map.getZoom(), 13), essential: true })
            }
          } else if (json.card.geo) {
            map.flyTo({ center: [json.card.geo[1], json.card.geo[0]], zoom: json.card.zoom || 10, essential: true })
          }
        }

        if (meLoaded) {
          fetch('/api/anitabi/me/history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetType: 'bangumi', bangumiId: id }),
          }).catch(() => null)
        }
      } finally {
        setDetailLoading(false)
      }
    },
    [locale, meLoaded]
  )

  useEffect(() => {
    loadBootstrap().catch(() => null)
  }, [loadBootstrap])

  useEffect(() => {
    if (parsed.b) {
      openBangumi(parsed.b, parsed.p).catch(() => null)
    }
    loadMe().catch(() => null)
  }, [loadMe, openBangumi, parsed.b, parsed.p])

  useEffect(() => {
    const mapRoot = mapRootRef.current
    if (!mapRoot || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapRoot,
      style: buildStyle('street'),
      center: [parsed.lng, parsed.lat],
      zoom: parsed.z,
      pitchWithRotate: false,
      dragRotate: false,
    })

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.on('moveend', () => syncUrlRef.current())

    mapRef.current = map

    return () => {
      if (userMarkerRef.current) {
        userMarkerRef.current.remove()
        userMarkerRef.current = null
      }
      map.remove()
      mapRef.current = null
    }
  }, [parsed.lat, parsed.lng, parsed.z])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.setStyle(buildStyle(styleMode))
  }, [styleMode])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    for (const marker of markersRef.current) marker.remove()
    markersRef.current = []

    if (!detail) return

    const color = detail.card.color || '#ec4899'

    for (const point of detail.points) {
      if (!point.geo) continue
      const dot = document.createElement('button')
      dot.type = 'button'
      dot.style.width = point.id === selectedPointId ? '16px' : '12px'
      dot.style.height = point.id === selectedPointId ? '16px' : '12px'
      dot.style.borderRadius = '999px'
      dot.style.border = '2px solid white'
      dot.style.background = color
      dot.style.boxShadow = '0 1px 4px rgba(0,0,0,0.3)'
      dot.style.cursor = 'pointer'
      dot.title = point.name
      dot.addEventListener('click', () => {
        setSelectedPointId(point.id)
        fetch('/api/anitabi/me/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetType: 'point', pointId: point.id }),
        }).catch(() => null)
      })

      const marker = new maplibregl.Marker({ element: dot }).setLngLat([point.geo[1], point.geo[0]]).addTo(map)
      markersRef.current.push(marker)
    }
  }, [detail, selectedPointId])

  useEffect(() => {
    syncUrl()
  }, [syncUrl])

  useEffect(() => {
    const q = queryInput.trim()
    if (!q) {
      setSearchResult({ bangumi: [], points: [], cities: [] })
      return
    }

    const ctrl = new AbortController()
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/anitabi/search?locale=${encodeURIComponent(locale)}&q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        })
        if (!res.ok) return
        const json = (await res.json()) as SearchResult
        setSearchResult({
          bangumi: Array.isArray(json.bangumi) ? json.bangumi : [],
          points: Array.isArray(json.points) ? json.points : [],
          cities: Array.isArray(json.cities) ? json.cities : [],
        })
      } catch {
        // ignore
      }
    }, 220)

    return () => {
      ctrl.abort()
      window.clearTimeout(t)
    }
  }, [locale, queryInput])

  useEffect(() => {
    if (!locateHint) return
    const timer = window.setTimeout(() => {
      setLocateHint(null)
    }, 6000)
    return () => window.clearTimeout(timer)
  }, [locateHint])

  const onSubmitQuery = useCallback(() => {
    setQuery(queryInput.trim())
    setSearchOpen(false)
  }, [queryInput])

  const onRandom = useCallback(() => {
    if (!cards.length) return
    const picked = cards[Math.floor(Math.random() * cards.length)]
    if (!picked) return
    openBangumi(picked.id).catch(() => null)
  }, [cards, openBangumi])

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

  const onLocate = useCallback(() => {
    if (typeof window === 'undefined') return
    if (!window.isSecureContext) {
      setLocateHint(label.locateInsecure)
      return
    }

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocateHint(label.locateUnavailable)
      return
    }

    setLocating(true)
    setLocateHint(null)

    const resolveSuccess = (position: GeolocationPosition) => {
      const map = mapRef.current
      if (!map) {
        setLocating(false)
        setLocateHint(label.mapNotReady)
        return
      }

      const { latitude, longitude, accuracy } = position.coords
      const zoom = accuracy <= 100 ? 15 : accuracy <= 500 ? 13 : 11
      map.flyTo({ center: [longitude, latitude], zoom, essential: true })
      paintUserMarker(longitude, latitude)
      setLocating(false)
      const acc = Number.isFinite(accuracy) ? Math.round(accuracy) : null
      setLocateHint(acc != null ? `${label.located} (±${acc}m)` : label.located)
    }

    const resolveError = (error: GeolocationPositionError, highAccuracy: boolean) => {
      if (highAccuracy && error.code !== error.PERMISSION_DENIED) {
        navigator.geolocation.getCurrentPosition(
          resolveSuccess,
          (error2) => {
            setLocating(false)
            if (error2.code === error2.PERMISSION_DENIED) {
              setLocateHint(label.locateDenied)
            } else if (error2.code === error2.TIMEOUT) {
              setLocateHint(label.locateTimeout)
            } else if (error2.code === error2.POSITION_UNAVAILABLE) {
              setLocateHint(label.locateUnavailable)
            } else {
              setLocateHint(label.locateFailed)
            }
          },
          {
            enableHighAccuracy: false,
            timeout: 10000,
            maximumAge: 300000,
          }
        )
        return
      }

      setLocating(false)
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

    navigator.geolocation.getCurrentPosition(
      resolveSuccess,
      (error) => resolveError(error, true),
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    )
  }, [label.locateDenied, label.locateFailed, label.locateInsecure, label.locateTimeout, label.locateUnavailable, label.located, label.mapNotReady, paintUserMarker])

  const onShare = useCallback(async () => {
    if (typeof window === 'undefined') return
    const href = window.location.href
    try {
      await navigator.clipboard.writeText(href)
    } catch {
      // ignore
    }
  }, [])

  const toggleFavorite = useCallback(
    async (payload: { targetType: 'bangumi' | 'point'; bangumiId?: number; pointId?: string }) => {
      if (!meLoaded || !meState) {
        const callback = encodeURIComponent(window.location.pathname + window.location.search)
        window.location.href = `/auth/signin?callbackUrl=${callback}`
        return
      }

      const targetKey = payload.targetType === 'bangumi' ? `bangumi:${payload.bangumiId}` : `point:${payload.pointId}`
      const remove = favoriteSet.has(targetKey)

      await fetch('/api/anitabi/me/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, remove }),
      })

      await loadMe()
    },
    [favoriteSet, loadMe, meLoaded, meState]
  )

  const tabs = bootstrap?.tabs || [
    { key: 'latest' as const, label: label.latest },
    { key: 'recent' as const, label: label.recent },
    { key: 'hot' as const, label: label.hot },
  ]

  return (
    <div data-layout-wide="true" className="h-[calc(100dvh-84px)] w-full overflow-hidden bg-slate-50">
      <div className="grid h-full grid-cols-1 lg:grid-cols-[400px_minmax(0,1fr)]">
        <aside className="flex h-full flex-col border-r border-slate-200 bg-white">
          <div className="space-y-3 border-b border-slate-200 px-4 py-4">
            <div className="flex items-center justify-between gap-2">
              <h1 className="text-lg font-semibold text-slate-900">{label.title}</h1>
              <div className="flex items-center gap-1">
                <button
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                  onClick={() => setStyleMode(styleMode === 'street' ? 'satellite' : 'street')}
                  type="button"
                >
                  {styleMode === 'street' ? '卫星' : '街道'}
                </button>
                <button
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={onLocate}
                  type="button"
                  disabled={locating}
                >
                  {locating ? label.locating : label.locate}
                </button>
                <button className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100" onClick={onRandom} type="button">
                  {label.random}
                </button>
              </div>
            </div>

            {locateHint ? <div className="text-xs text-slate-500">{locateHint}</div> : null}

            <div className="relative">
              <div className="flex gap-2">
                <input
                  value={queryInput}
                  onFocus={() => setSearchOpen(true)}
                  onChange={(e) => setQueryInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onSubmitQuery()
                  }}
                  placeholder={label.searchPlaceholder}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-400"
                />
                <button className="rounded-md bg-brand-500 px-3 py-2 text-xs font-medium text-white hover:bg-brand-600" onClick={onSubmitQuery} type="button">
                  搜索
                </button>
              </div>

              {searchOpen && (searchResult.bangumi.length > 0 || searchResult.points.length > 0 || searchResult.cities.length > 0) ? (
                <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border border-slate-200 bg-white p-2 shadow-xl">
                  {searchResult.cities.slice(0, 6).map((city) => (
                    <button
                      key={`city:${city}`}
                      type="button"
                      className="mb-1 block w-full rounded px-2 py-1 text-left text-sm text-slate-700 hover:bg-slate-100"
                      onClick={() => {
                        setSelectedCity(city)
                        setSearchOpen(false)
                      }}
                    >
                      城市：{city}
                    </button>
                  ))}
                  {searchResult.bangumi.slice(0, 10).map((item) => (
                    <button
                      key={`bangumi:${item.id}`}
                      type="button"
                      className="mb-1 block w-full rounded px-2 py-1 text-left text-sm text-slate-700 hover:bg-slate-100"
                      onClick={() => {
                        openBangumi(item.id).catch(() => null)
                        setSearchOpen(false)
                      }}
                    >
                      作品：{item.title}
                    </button>
                  ))}
                  {searchResult.points.slice(0, 10).map((point) => (
                    <button
                      key={`point:${point.id}`}
                      type="button"
                      className="mb-1 block w-full rounded px-2 py-1 text-left text-sm text-slate-700 hover:bg-slate-100"
                      onClick={() => {
                        openBangumi(point.bangumiId, point.id).catch(() => null)
                        setSearchOpen(false)
                      }}
                    >
                      地标：{point.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`rounded-full border px-2 py-1 text-xs ${!selectedCity ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600 hover:bg-slate-100'}`}
                onClick={() => setSelectedCity('')}
              >
                全部
              </button>
              {(bootstrap?.facets.cities || []).map((city) => (
                <button
                  key={city}
                  type="button"
                  className={`rounded-full border px-2 py-1 text-xs ${selectedCity === city ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600 hover:bg-slate-100'}`}
                  onClick={() => setSelectedCity(city)}
                >
                  {city}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              {tabs.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`rounded-md px-3 py-1.5 text-xs ${tab === item.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                  onClick={() => setTab(item.key)}
                >
                  {item.label}
                </button>
              ))}
              <button className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100" type="button" onClick={() => setChangelogOpen((v) => !v)}>
                {label.changelog}
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
            {loading ? <div className="text-sm text-slate-500">{label.loading}</div> : null}
            {!loading && cards.length === 0 ? <div className="text-sm text-slate-500">{label.noData}</div> : null}
            <div className="space-y-3">
              {cards.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => openBangumi(card.id).catch(() => null)}
                  className={`w-full rounded-xl border p-3 text-left transition ${selectedBangumiId === card.id ? 'border-brand-400 bg-brand-50/70' : 'border-slate-200 bg-white hover:border-brand-200 hover:bg-brand-50/30'}`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="line-clamp-1 text-sm font-semibold text-slate-900">{card.title}</h3>
                    <span className="text-[10px] text-slate-500">{card.cat || ''}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    {card.city ? <span>{card.city}</span> : null}
                    <span>·</span>
                    <span>{card.pointsLength} {label.points}</span>
                    <span>·</span>
                    <span>{card.imagesLength} {label.screenshots}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="relative h-full">
          <div ref={mapRootRef} className="h-full w-full" />

          <div className="pointer-events-none absolute inset-x-4 top-4 z-20 flex justify-end gap-2">
            <button className="pointer-events-auto rounded-md bg-white/90 px-3 py-1.5 text-xs text-slate-700 shadow hover:bg-white" type="button" onClick={onShare}>
              {label.share}
            </button>
          </div>

          {detail ? (
            <div className="absolute right-4 top-14 z-20 max-h-[calc(100%-80px)] w-[340px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                <div>
                  <div className="line-clamp-1 text-sm font-semibold text-slate-900">{detail.card.title}</div>
                  <div className="text-xs text-slate-500">{detail.card.city || '-'} · {detail.points.length} {label.points}</div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                    onClick={() => toggleFavorite({ targetType: 'bangumi', bangumiId: detail.card.id }).catch(() => null)}
                    title={meState ? label.favorites : label.signInToFavorite}
                  >
                    {favoriteSet.has(`bangumi:${detail.card.id}`) ? '★' : '☆'}
                  </button>
                  <button type="button" className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100" onClick={() => setDetail(null)}>
                    {label.close}
                  </button>
                </div>
              </div>

              {selectedPoint ? (
                <div className="space-y-2 border-b border-slate-200 px-3 py-3">
                  <div className="text-sm font-medium text-slate-900">{selectedPoint.name}</div>
                  {selectedPoint.image ? <img src={selectedPoint.image} alt={selectedPoint.name} className="h-40 w-full rounded-md object-cover" /> : null}
                  <div className="flex flex-wrap items-center gap-1 text-xs text-slate-600">
                    {selectedPoint.ep ? <span>EP {selectedPoint.ep}</span> : null}
                    {selectedPoint.s ? <span>· {selectedPoint.s}</span> : null}
                    {selectedPoint.origin ? <span>· {selectedPoint.origin}</span> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {geoLink(selectedPoint) ? (
                      <a className="rounded bg-slate-900 px-2 py-1 text-xs text-white no-underline hover:bg-slate-700" href={geoLink(selectedPoint) || '#'} target="_blank" rel="noreferrer">
                        {label.openInGoogle}
                      </a>
                    ) : null}
                    <button
                      type="button"
                      className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                      onClick={() => toggleFavorite({ targetType: 'point', pointId: selectedPoint.id }).catch(() => null)}
                    >
                      {favoriteSet.has(`point:${selectedPoint.id}`) ? '★' : '☆'} {label.favorites}
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="max-h-[420px] overflow-auto px-3 py-2">
                {detailLoading ? <div className="py-4 text-sm text-slate-500">{label.loading}</div> : null}
                <div className="space-y-1">
                  {detail.points.map((point) => (
                    <button
                      key={point.id}
                      type="button"
                      className={`block w-full rounded px-2 py-1.5 text-left text-xs ${selectedPointId === point.id ? 'bg-brand-100 text-brand-800' : 'text-slate-700 hover:bg-slate-100'}`}
                      onClick={() => {
                        setSelectedPointId(point.id)
                        if (point.geo && mapRef.current) {
                          mapRef.current.flyTo({ center: [point.geo[1], point.geo[0]], zoom: Math.max(mapRef.current.getZoom(), 13), essential: true })
                        }
                      }}
                    >
                      <span className="font-medium">{point.name}</span>
                      {point.ep ? <span className="ml-1 text-slate-500">EP {point.ep}</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {changelogOpen ? (
            <div className="absolute bottom-4 left-4 z-20 max-h-[45vh] w-[360px] overflow-auto rounded-xl border border-slate-200 bg-white/95 p-3 shadow-2xl backdrop-blur">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">{label.changelog}</h2>
                <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100" onClick={() => setChangelogOpen(false)}>
                  {label.close}
                </button>
              </div>
              <div className="space-y-3 text-xs text-slate-700">
                {(bootstrap?.changelog || []).map((item: AnitabiChangelogDTO) => (
                  <div key={item.id} className="rounded-md border border-slate-200 bg-white p-2">
                    <div className="mb-1 text-[11px] text-slate-500">{item.date}</div>
                    <div className="mb-1 font-medium text-slate-900">{item.title}</div>
                    <div className="whitespace-pre-wrap leading-relaxed text-slate-700">{item.body}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
