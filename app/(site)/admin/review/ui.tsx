"use client"

import Link from 'next/link'
import { useEffect, useState } from 'react'

type ReviewListItem = {
  id: string
  slug: string
  title: string
  status: string
  updatedAt?: string
}

type ApiResponse =
  | { ok: true; items: ReviewListItem[] }
  | { error: string }

export default function AdminReviewListClient() {
  const [items, setItems] = useState<ReviewListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    const res = await fetch('/api/admin/review/articles?status=in_review', { method: 'GET' })
    const data = (await res.json().catch(() => ({}))) as ApiResponse
    if (!res.ok || 'error' in data) {
      setError(('error' in data && data.error) || '加载失败')
      setLoading(false)
      return
    }
    setItems(data.items || [])
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">待审文章</h1>
        <p className="mt-1 text-sm text-gray-600">仅展示状态为 in_review 的文章。</p>
      </div>

      {loading ? <div className="text-gray-600">加载中…</div> : null}
      {error ? <div className="rounded-md bg-rose-50 p-3 text-rose-700">{error}</div> : null}

      {!loading && !error ? (
        <ul className="space-y-3">
          {items.map((a) => (
            <li key={a.id} className="card">
              <Link href={`/admin/review/${a.id}`} className="font-semibold">
                {a.title}
              </Link>
              <div className="mt-1 text-sm text-gray-600">slug：{a.slug}</div>
            </li>
          ))}
          {!items.length ? <li className="text-gray-500">暂无待审文章。</li> : null}
        </ul>
      ) : null}
    </div>
  )
}

