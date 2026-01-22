"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import Button from '@/components/shared/Button'

export type CityOption = {
  id: string
  slug: string
  name_zh: string
  name_en?: string | null
  name_ja?: string | null
}

type Props = {
  value: CityOption[]
  onChange: (next: CityOption[]) => void
  disabled?: boolean
  label?: string
  placeholder?: string
}

function dedupeById(list: CityOption[]): CityOption[] {
  const out: CityOption[] = []
  const seen = new Set<string>()
  for (const c of list) {
    if (!c?.id || seen.has(c.id)) continue
    seen.add(c.id)
    out.push(c)
  }
  return out
}

export default function CityMultiSelect({
  value,
  onChange,
  disabled,
  label = '城市（可选，可多选）',
  placeholder = '搜索城市或输入新城市名…',
}: Props) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<CityOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastFetch = useRef(0)

  const cleanedQ = q.trim()
  const canCreate = cleanedQ.length > 0

  const selected = useMemo(() => dedupeById(value || []), [value])

  useEffect(() => {
    if (!open) return
    const now = Date.now()
    lastFetch.current = now
    setLoading(true)
    setError(null)

    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/city/search?q=${encodeURIComponent(cleanedQ)}&limit=12`, { method: 'GET' })
          const data = await res.json().catch(() => ({}))
          if (!res.ok || !data?.ok) {
            setItems([])
            setError(data?.error || '加载失败')
            return
          }
          if (lastFetch.current !== now) return
          setItems(Array.isArray(data.items) ? (data.items as CityOption[]) : [])
        } catch (e: any) {
          if (lastFetch.current !== now) return
          setItems([])
          setError(e?.message || '加载失败')
        } finally {
          if (lastFetch.current === now) setLoading(false)
        }
      })()
    }, 250)

    return () => window.clearTimeout(handle)
  }, [cleanedQ, open])

  function isSelected(id: string): boolean {
    return selected.some((c) => c.id === id)
  }

  function addCity(city: CityOption) {
    const next = dedupeById([...selected, city])
    onChange(next)
    setQ('')
    setOpen(false)
  }

  function removeCity(id: string) {
    onChange(selected.filter((c) => c.id !== id))
  }

  async function createFromQuery() {
    if (!canCreate || disabled) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/city/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names: [cleanedQ] }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        setError(data?.error || '创建失败')
        return
      }
      const created = Array.isArray(data.cities) ? (data.cities[0] as CityOption) : null
      if (created?.id) addCity(created)
    } catch (e: any) {
      setError(e?.message || '创建失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium">{label}</label>

      <div className="mt-2 flex flex-wrap gap-2">
        {selected.map((c, idx) => (
          <span key={c.id} className="inline-flex items-center gap-1 rounded-full bg-pink-100 px-3 py-1 text-sm text-pink-800">
            <span className="max-w-[16rem] truncate">
              {c.name_zh}
              {idx === 0 ? <span className="ml-1 text-xs text-pink-700/70">(主)</span> : null}
            </span>
            <button
              type="button"
              className="ml-1 text-pink-800/70 hover:text-pink-900"
              onClick={() => removeCity(c.id)}
              disabled={disabled}
              aria-label={`移除城市 ${c.name_zh}`}
            >
              ×
            </button>
          </span>
        ))}
        {!selected.length ? <span className="text-sm text-gray-500">尚未选择城市</span> : null}
      </div>

      <div className="mt-3">
        <input
          className="w-full rounded-md border px-3 py-2"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            if (!open) setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false)
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              if (items.length) {
                const first = items[0]
                if (first?.id && !isSelected(first.id)) addCity(first)
                return
              }
              void createFromQuery()
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
        />

        {open ? (
          <div className="mt-2 rounded-md border bg-white">
            <div className="px-3 py-2 text-xs text-gray-500">
              {loading
                ? '加载中…'
                : error
                  ? error
                  : items.length
                    ? '选择一个匹配项（或继续输入）'
                    : cleanedQ
                      ? '未找到匹配项，按 Enter 创建'
                      : '输入关键词开始搜索'}
            </div>

            {items.length ? (
              <ul className="max-h-48 overflow-auto border-t">
                {items.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-pink-50 disabled:opacity-60"
                      onClick={() => addCity(c)}
                      disabled={disabled || isSelected(c.id)}
                    >
                      <span className="truncate">{c.name_zh}</span>
                      <span className="shrink-0 text-xs text-gray-500">{c.slug}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {canCreate ? (
              <div className="border-t px-3 py-2">
                <Button type="button" variant="ghost" onClick={createFromQuery} disabled={disabled || loading}>
                  {loading ? '处理中…' : `创建：${cleanedQ}`}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
