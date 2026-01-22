"use client"

import Link from 'next/link'
import { useEffect, useState } from 'react'
import Button from '@/components/shared/Button'

type CityItem = {
  id: string
  slug: string
  name_zh: string
  name_en?: string | null
  name_ja?: string | null
  cover?: string | null
  needsReview?: boolean
  hidden?: boolean
  aliasCount?: number
  postCount?: number
}

type ListResponse = { ok: true; items: CityItem[] } | { error: string }

export default function AdminCityListClient() {
  const [items, setItems] = useState<CityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')

  async function load(query: string = '') {
    setLoading(true)
    setError(null)
    const res = await fetch(`/api/admin/city?q=${encodeURIComponent(query)}`, { method: 'GET' })
    const data = (await res.json().catch(() => ({}))) as ListResponse
    if (!res.ok || 'error' in data) {
      setError(('error' in data && data.error) || '加载失败')
      setItems([])
      setLoading(false)
      return
    }
    setItems(data.items || [])
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  function onSearch(e: React.FormEvent) {
    e.preventDefault()
    void load(q)
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">城市管理</h1>
        <p className="mt-1 text-sm text-gray-600">
          <Link href="/admin/panel" className="hover:underline">返回面板</Link>
          {' · '}
          管理城市元数据、别名与合并。
        </p>
      </div>

      <form onSubmit={onSearch} className="flex gap-2">
        <input
          className="w-full max-w-xs rounded-md border px-3 py-2 text-sm"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索 slug / 名称 / 别名"
        />
        <Button type="submit" disabled={loading}>搜索</Button>
      </form>

      {loading ? <div className="text-gray-600">加载中…</div> : null}
      {error ? <div className="rounded-md bg-rose-50 p-3 text-rose-700">{error}</div> : null}

      {!loading && !error ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <li key={c.id} className={`card ${c.hidden ? 'opacity-60 bg-gray-50' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <Link href={`/admin/panel/city/${encodeURIComponent(c.id)}`} className="font-semibold hover:underline">
                  {c.name_zh}
                </Link>
                <div className="flex items-center gap-1">
                  {c.needsReview ? (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">待完善</span>
                  ) : null}
                  {c.hidden ? (
                    <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-600">已隐藏</span>
                  ) : null}
                </div>
              </div>
              <div className="mt-1 text-xs text-gray-500 font-mono">{c.slug}</div>
              <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                <span>{c.postCount || 0} 篇文章</span>
                <span>{c.aliasCount || 0} 别名</span>
              </div>
            </li>
          ))}
          {!items.length && <li className="text-gray-500 col-span-full">暂无匹配城市。</li>}
        </ul>
      ) : null}
    </div>
  )
}
