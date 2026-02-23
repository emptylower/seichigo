"use client"

import { useEffect, useMemo, useState } from 'react'

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

  const dbCount = useMemo(() => items.filter((item) => item.source === 'db').length, [items])
  const mdxCount = items.length - dbCount

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-5 w-40 animate-pulse rounded bg-pink-100" />
        <div className="grid gap-3">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={idx} className="rounded-2xl border border-pink-100/90 bg-white/90 p-4 shadow-sm">
              <div className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
              <div className="mt-3 h-3 w-24 animate-pulse rounded bg-slate-100" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700">
        <p>{error}</p>
        <button
          type="button"
          className="mt-3 inline-flex rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-100"
          onClick={() => void load()}
        >
          重新加载
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5 text-xs font-medium">
        <span className="inline-flex rounded-full border border-pink-200 bg-pink-50 px-3 py-1 text-pink-700">
          共 {items.length} 条收藏
        </span>
        <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600">
          站内文章 {dbCount}
        </span>
        <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600">
          精选内容 {mdxCount}
        </span>
        <a href="/posts" className="ml-auto inline-flex rounded-full border border-pink-100 bg-white px-3 py-1 text-pink-700 no-underline hover:border-pink-200">
          去逛文章
        </a>
      </div>
      {items.length ? (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={`${item.source}:${item.slug}`}
              className="rounded-2xl border border-pink-100/90 bg-gradient-to-br from-white via-white to-pink-50/50 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex items-center gap-2 text-xs">
                    <span className={`inline-flex rounded-full px-2.5 py-1 font-medium ${item.source === 'db' ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600'}`}>
                      {item.source === 'db' ? '站内文章' : '精选内容'}
                    </span>
                    <span className="text-slate-500">
                      {new Date(item.createdAt).toLocaleDateString('zh-CN')}
                    </span>
                  </div>
                  <a href={`/posts/${item.slug}`} className="block truncate text-[15px] font-semibold text-slate-800 no-underline hover:text-brand-700">
                    {item.title}
                  </a>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`/posts/${item.slug}`}
                    className="inline-flex rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 no-underline hover:border-pink-200 hover:text-pink-700"
                  >
                    查看
                  </a>
                  <button
                    type="button"
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                    onClick={() => void removeFavorite(item)}
                  >
                    取消收藏
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-2xl border border-dashed border-pink-200 bg-white/80 p-8 text-center">
          <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-pink-50 text-pink-500">
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M11.1 20.6a1.2 1.2 0 0 0 1.8 0l7-7.7a5.2 5.2 0 0 0-7.7-7 5.2 5.2 0 0 0-7.7 7z" />
            </svg>
          </div>
          <p className="text-gray-700">你还没有收藏内容。</p>
          <p className="mt-1 text-sm text-gray-500">
            在文章页点击收藏后，这里会自动帮你归档。
          </p>
          <a href="/posts" className="mt-4 inline-flex rounded-full border border-pink-100 bg-white px-4 py-1.5 text-sm text-pink-700 no-underline hover:border-pink-200">
            去发现内容
          </a>
        </div>
      )}
    </div>
  )
}
