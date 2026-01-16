"use client"

import Link from 'next/link'
import { useEffect, useState } from 'react'
import Button from '@/components/shared/Button'

type AnimeItem = {
  id: string
  name: string
  alias?: string[]
  hidden?: boolean
}

type ListResponse = { ok: true; items: AnimeItem[] } | { error: string }

export default function AdminAnimeListClient() {
  const [items, setItems] = useState<AnimeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')

  async function load(query: string = '') {
    setLoading(true)
    setError(null)
    const res = await fetch(`/api/admin/anime?q=${encodeURIComponent(query)}`, { method: 'GET' })
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
        <h1 className="text-2xl font-bold">作品管理</h1>
        <p className="mt-1 text-sm text-gray-600">
          <Link href="/admin/panel" className="hover:underline">返回面板</Link>
          {' · '}
          管理作品元数据（封面、简介、显隐）。
        </p>
      </div>

      <form onSubmit={onSearch} className="flex gap-2">
        <input
          className="w-full max-w-xs rounded-md border px-3 py-2 text-sm"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索 ID / 名称 / 别名"
        />
        <Button type="submit" disabled={loading}>搜索</Button>
      </form>

      {loading ? <div className="text-gray-600">加载中…</div> : null}
      {error ? <div className="rounded-md bg-rose-50 p-3 text-rose-700">{error}</div> : null}

      {!loading && !error ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((a) => (
            <li key={a.id} className={`card ${a.hidden ? 'opacity-60 bg-gray-50' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <Link href={`/admin/panel/anime/${encodeURIComponent(a.id)}`} className="font-semibold hover:underline">
                  {a.name}
                </Link>
                {a.hidden ? (
                  <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-600">
                    已隐藏
                  </span>
                ) : null}
              </div>
              <div className="mt-1 text-xs text-gray-500 font-mono">{a.id}</div>
              {a.alias?.length ? (
                <div className="mt-1 truncate text-xs text-gray-400">
                  {a.alias.join(' / ')}
                </div>
              ) : null}
            </li>
          ))}
          {!items.length && <li className="text-gray-500 col-span-full">暂无匹配作品。</li>}
        </ul>
      ) : null}
    </div>
  )
}
