"use client"

import Link from 'next/link'
import { useEffect, useState } from 'react'

type ReviewListItem = {
  id: string
  slug?: string
  title: string
  status: string
  updatedAt?: string
}

type ArticleListResponse = { ok: true; items: ReviewListItem[] } | { error: string }

type RevisionListItem = {
  id: string
  articleId: string
  authorId: string
  title: string
  status: string
  updatedAt?: string
}

type RevisionListResponse = { ok: true; items: RevisionListItem[] } | { error: string }

function toTimeMs(value: string | undefined): number {
  const ms = value ? Date.parse(value) : NaN
  return Number.isFinite(ms) ? ms : 0
}

export default function AdminReviewListClient() {
  const [items, setItems] = useState<ReviewListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    const [articlesRes, revisionsRes] = await Promise.all([
      fetch('/api/admin/review/articles?status=in_review', { method: 'GET' }),
      fetch('/api/admin/review/revisions?status=in_review', { method: 'GET' }),
    ])

    const articlesData = (await articlesRes.json().catch(() => ({}))) as ArticleListResponse
    const revisionsData = (await revisionsRes.json().catch(() => ({}))) as RevisionListResponse

    if (!articlesRes.ok || 'error' in articlesData) {
      setError(('error' in articlesData && articlesData.error) || '加载失败')
      setLoading(false)
      return
    }

    if (!revisionsRes.ok || 'error' in revisionsData) {
      setError(('error' in revisionsData && revisionsData.error) || '加载失败')
      setLoading(false)
      return
    }

    const revisionItems: ReviewListItem[] = (revisionsData.items || []).map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      updatedAt: r.updatedAt,
    }))

    const combined: ReviewListItem[] = [...(articlesData.items || []), ...revisionItems].sort(
      (a, b) => toTimeMs(b.updatedAt) - toTimeMs(a.updatedAt)
    )

    setItems(combined)
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">待审稿件</h1>
        <p className="mt-1 text-sm text-gray-600">仅展示状态为 in_review 的稿件（投稿/更新）。</p>
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
              {a.slug ? <div className="mt-1 text-sm text-gray-600">slug：{a.slug}</div> : null}
            </li>
          ))}
          {!items.length ? <li className="text-gray-500">暂无待审文章。</li> : null}
        </ul>
      ) : null}
    </div>
  )
}
