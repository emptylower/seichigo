"use client"

import Link from 'next/link'
import { useEffect, useState } from 'react'
import Button from '@/components/shared/Button'

type Tab = 'in_review' | 'published'

type PanelListItem = {
  id: string
  slug: string
  title: string
  status: string
  updatedAt?: string
}

type ApiResponse =
  | { ok: true; items: PanelListItem[] }
  | { error: string }

export default function AdminPanelClient() {
  const [tab, setTab] = useState<Tab>('in_review')
  const [items, setItems] = useState<PanelListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load(nextTab: Tab) {
    setLoading(true)
    setError(null)
    const res = await fetch(`/api/admin/review/articles?status=${nextTab}`, { method: 'GET' })
    const data = (await res.json().catch(() => ({}))) as ApiResponse
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
    void load(tab)
  }, [tab])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">管理员面板</h1>
        <p className="mt-1 text-sm text-gray-600">管理待审稿件与已发布文章。</p>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <Button variant={tab === 'in_review' ? 'primary' : 'ghost'} type="button" onClick={() => setTab('in_review')}>
          待审
        </Button>
        <Button variant={tab === 'published' ? 'primary' : 'ghost'} type="button" onClick={() => setTab('published')}>
          已发布
        </Button>
      </div>

      {loading ? <div className="text-gray-600">加载中…</div> : null}
      {error ? <div className="rounded-md bg-rose-50 p-3 text-rose-700">{error}</div> : null}

      {!loading && !error ? (
        <ul className="space-y-3">
          {items.map((a) => (
            <li key={a.id} className="card">
              <Link href={`/admin/panel/articles/${a.id}`} className="font-semibold">
                {a.title}
              </Link>
              <div className="mt-1 text-sm text-gray-600">slug：{a.slug}</div>
            </li>
          ))}
          {!items.length ? <li className="text-gray-500">暂无内容。</li> : null}
        </ul>
      ) : null}
    </div>
  )
}

