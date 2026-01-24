"use client"

import Link from 'next/link'
import { useEffect, useState } from 'react'
import Button from '@/components/shared/Button'

type Tab = 'in_review' | 'published'

type PanelListItem = {
  id: string
  slug?: string
  title: string
  status: string
  updatedAt?: string
}

type ArticleListResponse = { ok: true; items: PanelListItem[] } | { error: string }

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

export default function AdminPanelClient() {
  const [tab, setTab] = useState<Tab>('in_review')
  const [items, setItems] = useState<PanelListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load(nextTab: Tab) {
    setLoading(true)
    setError(null)
    if (nextTab === 'in_review') {
      const [articlesRes, revisionsRes] = await Promise.all([
        fetch('/api/admin/review/articles?status=in_review', { method: 'GET' }),
        fetch('/api/admin/review/revisions?status=in_review', { method: 'GET' }),
      ])

      const articlesData = (await articlesRes.json().catch(() => ({}))) as ArticleListResponse
      const revisionsData = (await revisionsRes.json().catch(() => ({}))) as RevisionListResponse

      if (!articlesRes.ok || 'error' in articlesData) {
        setError(('error' in articlesData && articlesData.error) || '加载失败')
        setItems([])
        setLoading(false)
        return
      }

      if (!revisionsRes.ok || 'error' in revisionsData) {
        setError(('error' in revisionsData && revisionsData.error) || '加载失败')
        setItems([])
        setLoading(false)
        return
      }

      const revisionItems: PanelListItem[] = (revisionsData.items || []).map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        updatedAt: r.updatedAt,
      }))

      const combined: PanelListItem[] = [...(articlesData.items || []), ...revisionItems].sort(
        (a, b) => toTimeMs(b.updatedAt) - toTimeMs(a.updatedAt)
      )

      setItems(combined)
      setLoading(false)
      return
    }

    const res = await fetch(`/api/admin/review/articles?status=${nextTab}`, { method: 'GET' })
    const data = (await res.json().catch(() => ({}))) as ArticleListResponse
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
        <Link href="/admin/panel/anime">
          <Button variant="ghost" type="button">作品管理</Button>
        </Link>
        <Link href="/admin/panel/city">
          <Button variant="ghost" type="button">城市管理</Button>
        </Link>
      </div>

      {loading ? <div className="text-gray-600">加载中…</div> : null}
      {error ? <div className="rounded-md bg-rose-50 p-3 text-rose-700">{error}</div> : null}

      {!loading && !error ? (
        <ul className="space-y-3">
          {items.map((a) => (
            <li key={a.id} className="card">
              <Link href={tab === 'in_review' ? `/admin/review/${a.id}` : `/admin/panel/articles/${a.id}`} className="font-semibold">
                {a.title}
              </Link>
              {a.slug ? <div className="mt-1 text-sm text-gray-600">slug：{a.slug}</div> : null}
            </li>
          ))}
          {!items.length ? <li className="text-gray-500">暂无内容。</li> : null}
        </ul>
      ) : null}
    </div>
  )
}
