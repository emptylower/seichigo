"use client"

import { useState } from 'react'
import type { FavoriteTarget } from '@/lib/favorite/repo'

export default function FavoriteButton(props: { target: FavoriteTarget; initialFavorited: boolean; loggedIn: boolean }) {
  const { target, initialFavorited, loggedIn } = props
  const [favorited, setFavorited] = useState(initialFavorited)
  const [loading, setLoading] = useState(false)

  if (!loggedIn) {
    return (
      <a href="/auth/signin" className="rounded-md border px-3 py-1 text-sm text-gray-600 hover:bg-gray-50">
        登录后收藏
      </a>
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
        if (!res.ok) throw new Error('收藏失败')
        setFavorited(true)
        return
      }

      const url = target.source === 'db' ? `/api/favorites/${target.articleId}` : `/api/favorites/mdx/${target.slug}`
      const res = await fetch(url, { method: 'DELETE' })
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

