'use client'

import { useEffect, useMemo, useState } from 'react'

type FavoriteDbItem = {
  source: 'db'
  articleId: string
  slug: string
  title: string
  description: string | null
  cover: string | null
  tags: string[]
  animeIds: string[]
  city: string | null
  createdAt: string
}

type FavoriteMdxItem = {
  source: 'mdx'
  slug: string
  title: string
  description: string | null
  cover: string | null
  tags: string[]
  animeIds: string[]
  city: string | null
  createdAt: string
}

type FavoriteItem = FavoriteDbItem | FavoriteMdxItem

type FavoritesResponse =
  | { ok: true; items: FavoriteItem[] }
  | { error: string }

function normalizeFavoriteItems(items: FavoriteItem[]): FavoriteItem[] {
  return items.map((item) => {
    const raw = item as FavoriteItem & {
      description?: unknown
      cover?: unknown
      tags?: unknown
      animeIds?: unknown
      city?: unknown
    }

    return {
      ...item,
      description: typeof raw.description === 'string' ? raw.description : null,
      cover: typeof raw.cover === 'string' ? raw.cover : null,
      tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      animeIds: Array.isArray(raw.animeIds) ? raw.animeIds.filter((id): id is string => typeof id === 'string') : [],
      city: typeof raw.city === 'string' ? raw.city : null,
    }
  })
}

const FAVORITE_FALLBACK_GRADIENTS = [
  'from-sky-400/85 via-cyan-300/80 to-brand-300/80',
  'from-brand-400/85 via-rose-300/80 to-orange-200/80',
  'from-violet-400/85 via-fuchsia-300/80 to-brand-300/80',
  'from-emerald-400/80 via-cyan-300/75 to-sky-200/75',
] as const

function pickFavoriteGradient(seed: string): string {
  let value = 0
  for (const char of seed) value = (value * 33 + char.charCodeAt(0)) % 997
  return FAVORITE_FALLBACK_GRADIENTS[value % FAVORITE_FALLBACK_GRADIENTS.length]
}

function formatDate(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '最近收藏'
  return parsed.toLocaleDateString('zh-CN')
}

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
    setItems(normalizeFavoriteItems(data.items || []))
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
      <div className="space-y-4">
        <div className="h-5 w-40 animate-pulse rounded bg-pink-100" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="overflow-hidden rounded-3xl border border-pink-100/90 bg-white/90 shadow-sm">
              <div className="aspect-[16/10] animate-pulse bg-slate-200" />
              <div className="space-y-3 p-4">
                <div className="h-4 w-4/5 animate-pulse rounded bg-slate-200" />
                <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" />
              </div>
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
    <div className="space-y-5">
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
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const fallbackGradient = pickFavoriteGradient(`${item.slug}:${item.source}`)
            const summary = item.description || '已收藏，随时继续阅读并补全你的巡礼路线。'
            const chips = [item.city, ...item.tags.slice(0, 2)].filter(Boolean)

            return (
              <li
                key={`${item.source}:${item.slug}`}
                className="group overflow-hidden rounded-[26px] border border-pink-100/90 bg-white shadow-[0_18px_35px_-28px_rgba(15,23,42,0.45)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_22px_42px_-26px_rgba(219,39,119,0.35)]"
              >
                <div className="relative isolate aspect-[16/10] overflow-hidden">
                  {item.cover ? (
                    <img
                      src={item.cover}
                      alt={item.title}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                    />
                  ) : (
                    <div className={`h-full w-full bg-gradient-to-br ${fallbackGradient}`} />
                  )}
                  <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgba(2,6,23,0.76)_8%,rgba(2,6,23,0.08)_55%,rgba(255,255,255,0)_100%)]" />
                  <div className="absolute left-3 top-3 inline-flex rounded-full border border-white/60 bg-white/75 px-2.5 py-1 text-[11px] font-semibold text-slate-700 backdrop-blur-sm">
                    {item.source === 'db' ? '站内文章' : '精选内容'}
                  </div>
                  <div className="absolute right-3 top-3 inline-flex rounded-full border border-white/50 bg-black/25 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
                    {formatDate(item.createdAt)}
                  </div>
                  <div className="absolute bottom-3 left-3 right-3">
                    <h3 className="line-clamp-2 text-lg font-semibold leading-snug text-white drop-shadow-sm">
                      {item.title}
                    </h3>
                  </div>
                </div>

                <div className="space-y-3 p-4">
                  <p className="line-clamp-3 text-sm leading-6 text-slate-600">{summary}</p>

                  <div className="flex min-h-[30px] flex-wrap items-center gap-1.5">
                    {chips.length > 0 ? (
                      chips.map((chip) => (
                        <span key={`${item.slug}-${chip}`} className="inline-flex rounded-full border border-pink-100 bg-pink-50/60 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                          {chip}
                        </span>
                      ))
                    ) : (
                      <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500">
                        {item.animeIds.slice(0, 1)[0] || '未分类'}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <a
                      href={`/posts/${item.slug}`}
                      className="inline-flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 no-underline transition hover:border-pink-200 hover:text-pink-700"
                    >
                      查看
                    </a>
                    <button
                      type="button"
                      className="inline-flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-rose-200 hover:text-rose-600"
                      onClick={() => void removeFavorite(item)}
                    >
                      取消收藏
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
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
