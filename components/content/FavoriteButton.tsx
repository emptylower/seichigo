"use client"

import { useEffect, useState } from 'react'
import type { FavoriteTarget } from '@/lib/favorite/repo'

type FavoriteListItem =
  | { source: 'db'; articleId: string; slug: string; title: string; createdAt: string }
  | { source: 'mdx'; slug: string; title: string; createdAt: string }

export default function FavoriteButton(props: { target: FavoriteTarget; initialFavorited?: boolean; loggedIn?: boolean }) {
  const { target, initialFavorited = false, loggedIn: loggedInProp } = props
  const [favorited, setFavorited] = useState(initialFavorited)
  const [loading, setLoading] = useState(false)
  const [loggedIn, setLoggedIn] = useState<boolean | null>(typeof loggedInProp === 'boolean' ? loggedInProp : null)

  useEffect(() => {
    if (typeof loggedInProp === 'boolean') {
      setLoggedIn(loggedInProp)
      return
    }

    let cancelled = false
    async function hydrate() {
      try {
        const res = await fetch('/api/favorites', { method: 'GET' })
        if (cancelled) return
        if (res.status === 401) {
          setLoggedIn(false)
          return
        }
        if (!res.ok) {
          // Treat unknown failures as logged-out so we don't block the UI.
          setLoggedIn(false)
          return
        }
        const json = (await res.json().catch(() => null)) as null | { ok?: boolean; items?: FavoriteListItem[] }
        const items = Array.isArray(json?.items) ? json!.items : []
        setLoggedIn(true)
        setFavorited(
          items.some((it) => {
            if (target.source === 'db') return it.source === 'db' && it.articleId === target.articleId
            return it.source === 'mdx' && it.slug === target.slug
          })
        )
      } catch {
        if (!cancelled) setLoggedIn(false)
      }
    }

    void hydrate()
    return () => {
      cancelled = true
    }
  }, [loggedInProp, target])

  if (loggedIn === false) {
    return (
      <a href="/auth/signin" className="rounded-md border px-3 py-1 text-sm text-gray-600 hover:bg-gray-50">
        登录后收藏
      </a>
    )
  }

  if (loggedIn === null) {
    return (
      <button type="button" className="rounded-md border px-3 py-1 text-sm text-gray-700 opacity-60" disabled>
        收藏
      </button>
    )
  }

  async function toggle() {
    if (loading) return
    setLoading(true)
    try {
      if (!favorited) {
        const res = await fetch('/api/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(target),
        })
        if (res.status === 401) {
          setLoggedIn(false)
          return
        }
        if (!res.ok) throw new Error('收藏失败')
        setFavorited(true)
        return
      }

      const url = target.source === 'db' ? `/api/favorites/${target.articleId}` : `/api/favorites/mdx/${target.slug}`
      const res = await fetch(url, { method: 'DELETE' })
      if (res.status === 401) {
        setLoggedIn(false)
        return
      }
      if (!res.ok) throw new Error('取消收藏失败')
      setFavorited(false)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      className={[
        'rounded-md border px-3 py-1 text-sm transition-colors',
        favorited ? 'border-pink-200 bg-pink-50 text-pink-700 hover:bg-pink-100' : 'border-gray-200 text-gray-700 hover:bg-gray-50',
        loading ? 'opacity-60' : '',
      ].join(' ')}
      onClick={() => void toggle()}
      disabled={loading}
    >
      {favorited ? '已收藏' : '收藏'}
    </button>
  )
}
