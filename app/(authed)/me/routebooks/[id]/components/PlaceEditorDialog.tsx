'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, MapPin, Search, X } from 'lucide-react'
import type { PlaceKind, PlaceRecord } from '../types'
import type { SupportedLocale } from '@/lib/i18n/types'
import { tr } from '../../i18n'

export type PlaceEditorSubmit = {
  kind: PlaceKind
  title: string
  address: string | null
  lat: number
  lng: number
  note: string | null
}

type GeocodeResult = { title: string; address: string; lat: number; lng: number }

const PLACE_KINDS: PlaceKind[] = ['lodging', 'station', 'restaurant', 'other']

type Props = {
  open: boolean
  /** 传入则为编辑模式 */
  place?: PlaceRecord | null
  presetKind?: PlaceKind
  /** 地图右键/长按预填的坐标 */
  initialCoords?: { lat: number; lng: number } | null
  /** 返回 true/undefined 表示成功（对话框自行关闭） */
  onSubmit: (input: PlaceEditorSubmit) => Promise<boolean | void> | boolean | void
  onClose: () => void
  locale?: SupportedLocale
}

function parseCoordInput(raw: string): number | null {
  const value = Number(raw)
  return raw.trim() !== '' && Number.isFinite(value) ? value : null
}

/** 新建/编辑自定义点：kind、名称、地址搜索（契约 GET /api/geocode/search）、经纬度微调、备注 */
export function PlaceEditorDialog({
  open,
  place = null,
  presetKind,
  initialCoords = null,
  onSubmit,
  onClose,
  locale = 'zh',
}: Props) {
  const [kind, setKind] = useState<PlaceKind>('other')
  const [title, setTitle] = useState('')
  const [address, setAddress] = useState('')
  const [latText, setLatText] = useState('')
  const [lngText, setLngText] = useState('')
  const [note, setNote] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [submitting, setSubmitting] = useState(false)
  const searchTimerRef = useRef<number | null>(null)
  const searchSeqRef = useRef(0)

  // 打开时按模式初始化表单
  useEffect(() => {
    if (!open) return
    setKind(place?.kind ?? presetKind ?? 'other')
    setTitle(place?.title ?? '')
    setAddress(place?.address ?? '')
    setLatText(place ? String(place.lat) : initialCoords ? String(Number(initialCoords.lat.toFixed(6))) : '')
    setLngText(place ? String(place.lng) : initialCoords ? String(Number(initialCoords.lng.toFixed(6))) : '')
    setNote(place?.note ?? '')
    setResults([])
    setSearching(false)
    setSubmitting(false)
  }, [open, place, presetKind, initialCoords])

  // 地址搜索：400ms 防抖，过期响应丢弃；无结果/失败都静默为空列表
  useEffect(() => {
    if (!open) return
    const query = address.trim()
    if (query.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current)
    setSearching(true)
    searchTimerRef.current = window.setTimeout(() => {
      const seq = ++searchSeqRef.current
      fetch(`/api/geocode/search?q=${encodeURIComponent(query)}&lang=${locale}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { ok?: boolean; results?: GeocodeResult[] } | null) => {
          if (seq !== searchSeqRef.current) return
          setResults(data?.ok && Array.isArray(data.results) ? data.results.slice(0, 5) : [])
          setSearching(false)
        })
        .catch(() => {
          if (seq !== searchSeqRef.current) return
          setResults([])
          setSearching(false)
        })
    }, 400)
    return () => {
      if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current)
    }
  }, [address, open, locale])

  if (!open) return null

  const lat = parseCoordInput(latText)
  const lng = parseCoordInput(lngText)
  const valid = title.trim().length > 0 && lat !== null && lat >= -90 && lat <= 90 && lng !== null && lng >= -180 && lng <= 180

  const pickResult = (row: GeocodeResult) => {
    setAddress(row.address || row.title)
    setLatText(String(Number(row.lat.toFixed(6))))
    setLngText(String(Number(row.lng.toFixed(6))))
    if (!title.trim()) setTitle(row.title)
    setResults([])
  }

  const handleSubmit = async () => {
    if (!valid || lat === null || lng === null || submitting) return
    setSubmitting(true)
    const outcome = await onSubmit({
      kind,
      title: title.trim(),
      address: address.trim() || null,
      lat,
      lng,
      note: note.trim() || null,
    })
    setSubmitting(false)
    if (outcome !== false) onClose()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label={tr('routebook.common.close', locale)}
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-[28px] border border-pink-100 bg-white p-5 shadow-2xl sm:rounded-[28px]">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <MapPin className="h-4 w-4 text-brand-500" />
            {place ? tr('routebook.place.dialogEdit', locale) : tr('routebook.place.dialogCreate', locale)}
          </h3>
          <button
            type="button"
            aria-label={tr('routebook.common.close', locale)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-pink-50 hover:text-slate-600"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <div className="mb-1.5 text-xs font-medium text-slate-500">{tr('routebook.place.kindLabel', locale)}</div>
            <div className="grid grid-cols-4 gap-1.5">
              {PLACE_KINDS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`min-h-9 rounded-xl border px-2 text-xs font-medium transition ${
                    kind === value
                      ? 'border-brand-500 bg-brand-500 text-white'
                      : 'border-pink-100 bg-white text-slate-600 hover:bg-pink-50'
                  }`}
                  onClick={() => setKind(value)}
                >
                  {tr(`routebook.placeKind.${value}`, locale)}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-500">{tr('routebook.place.titleLabel', locale)}</span>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={tr('routebook.place.titlePlaceholder', locale)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-300 focus:bg-white"
            />
          </label>

          <div className="relative">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">{tr('routebook.place.addressLabel', locale)}</span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  placeholder={tr('routebook.place.addressPlaceholder', locale)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-brand-300 focus:bg-white"
                />
                {searching ? (
                  <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-300" />
                ) : null}
              </div>
            </label>
            {results.length > 0 ? (
              <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-2xl border border-pink-100 bg-white py-1 shadow-lg">
                {results.map((row, index) => (
                  <li key={`${row.lat},${row.lng}:${index}`}>
                    <button
                      type="button"
                      className="block w-full px-3.5 py-2 text-left transition hover:bg-pink-50"
                      onClick={() => pickResult(row)}
                    >
                      <span className="block truncate text-sm font-medium text-slate-800">{row.title}</span>
                      <span className="block truncate text-xs text-slate-400">{row.address}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">{tr('routebook.place.latLabel', locale)}</span>
              <input
                type="number"
                step="0.000001"
                min={-90}
                max={90}
                value={latText}
                onChange={(event) => setLatText(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-300 focus:bg-white"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">{tr('routebook.place.lngLabel', locale)}</span>
              <input
                type="number"
                step="0.000001"
                min={-180}
                max={180}
                value={lngText}
                onChange={(event) => setLngText(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-300 focus:bg-white"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-500">{tr('routebook.place.noteLabel', locale)}</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={tr('routebook.place.notePlaceholder', locale)}
              rows={2}
              className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-300 focus:bg-white"
            />
          </label>

          <button
            type="button"
            disabled={!valid || submitting}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[20px] bg-brand-500 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-slate-300"
            onClick={() => void handleSubmit()}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {tr('routebook.place.submit', locale)}
          </button>
        </div>
      </div>
    </div>
  )
}
