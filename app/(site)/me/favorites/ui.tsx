"use client"

import { useEffect, useState } from 'react'

type FavoriteItem =
  | { source: 'db'; articleId: string; slug: string; title: string; createdAt: string }
  | { source: 'mdx'; slug: string; title: string; createdAt: string }

type FavoritesResponse =
  | { ok: true; items: FavoriteItem[] }
  | { error: string }

export default function FavoritesClient() {
  const [items, setItems] = useState<FavoriteItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    const res = await fetch('/api/favorites', { method: 'GET' })
    const data = (await res.json().catch(() => ({}))) as FavoritesResponse
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

  async function removeFavorite(item: FavoriteItem) {
    const url = item.source === 'db' ? `/api/favorites/${item.articleId}` : `/api/favorites/mdx/${item.slug}`
    const res = await fetch(url, { method: 'DELETE' })
    if (!res.ok) return
    setItems((prev) => prev.filter((x) => (x.source === 'db' && item.source === 'db' ? x.articleId !== item.articleId : x.slug !== item.slug)))
  }

  if (loading) return <div className="text-gray-600">加载中…</div>
  if (error) return <div className="rounded-md bg-rose-50 p-3 text-rose-700">{error}</div>

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">我的收藏</h1>
      {items.length ? (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={`${item.source}:${item.slug}`} className="card flex items-center justify-between gap-4">
              <div className="min-w-0">
                <a href={`/posts/${item.slug}`} className="block truncate font-medium">
                  {item.title}
                </a>
                <div className="mt-1 text-xs text-gray-500">{new Date(item.createdAt).toISOString().slice(0, 10)}</div>
              </div>
              <button
                type="button"
                className="rounded-md border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => void removeFavorite(item)}
              >
                取消收藏
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-gray-600">暂无收藏。</div>
      )}
    </div>
  )
}

