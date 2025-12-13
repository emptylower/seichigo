"use client"

import { useEffect, useMemo, useState } from 'react'
import Button from '@/components/shared/Button'

type User = { id: string; email?: string | null }

type ArticleListItem = {
  id: string
  slug: string
  title: string
  status: 'draft' | 'in_review' | 'rejected' | 'published'
  rejectReason: string | null
  updatedAt: string
}

type Props = {
  user: User | null
}

type Filter = 'all' | 'draftbox' | 'in_review' | 'published'

function formatStatus(status: ArticleListItem['status']) {
  if (status === 'draft') return '草稿'
  if (status === 'rejected') return '被拒'
  if (status === 'in_review') return '审核中'
  return '已发布'
}

export default function SubmitCenterClient({ user }: Props) {
  const [items, setItems] = useState<ArticleListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('draftbox')
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})

  const filtered = useMemo(() => {
    if (filter === 'all') return items
    if (filter === 'draftbox') return items.filter((x) => x.status === 'draft' || x.status === 'rejected')
    if (filter === 'in_review') return items.filter((x) => x.status === 'in_review')
    return items.filter((x) => x.status === 'published')
  }, [filter, items])

  async function load() {
    if (!user) return
    setError(null)
    setLoading(true)
    const qs = new URLSearchParams({ scope: 'mine' })
    const res = await fetch(`/api/articles?${qs.toString()}`)
    setLoading(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error || '加载失败')
      return
    }
    const j = await res.json()
    setItems(Array.isArray(j.items) ? j.items : [])
  }

  useEffect(() => {
    if (!user) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  async function submit(id: string) {
    setFlash(null)
    setError(null)
    setActionLoading((m) => ({ ...m, [id]: true }))
    const res = await fetch(`/api/articles/${id}/submit`, { method: 'POST' })
    setActionLoading((m) => ({ ...m, [id]: false }))
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error || '提交失败')
      return
    }
    setFlash('已提交审核')
    await load()
  }

  async function withdraw(id: string) {
    setFlash(null)
    setError(null)
    setActionLoading((m) => ({ ...m, [id]: true }))
    const res = await fetch(`/api/articles/${id}/withdraw`, { method: 'POST' })
    setActionLoading((m) => ({ ...m, [id]: false }))
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error || '撤回失败')
      return
    }
    setFlash('已撤回到草稿')
    await load()
  }

  if (!user) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">创作中心</h1>
        <p className="text-gray-600">请先登录后再进行创作与投稿。</p>
        <a className="btn-primary inline-flex w-fit" href="/auth/signin?callbackUrl=%2Fsubmit">
          去登录
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">创作中心</h1>
          <p className="mt-1 text-sm text-gray-600">草稿可编辑并提交审核；审核中可撤回；发布由管理员审核通过后生效。</p>
        </div>
        <a className="btn-primary inline-flex w-fit" href="/submit/new">
          新建文章
        </a>
      </header>

      <div className="flex flex-wrap gap-2 text-sm">
        <Button variant={filter === 'draftbox' ? 'primary' : 'ghost'} type="button" onClick={() => setFilter('draftbox')}>
          草稿箱
        </Button>
        <Button variant={filter === 'in_review' ? 'primary' : 'ghost'} type="button" onClick={() => setFilter('in_review')}>
          审核中
        </Button>
        <Button variant={filter === 'published' ? 'primary' : 'ghost'} type="button" onClick={() => setFilter('published')}>
          已发布
        </Button>
        <Button variant={filter === 'all' ? 'primary' : 'ghost'} type="button" onClick={() => setFilter('all')}>
          全部
        </Button>
      </div>

      {flash ? <div className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">{flash}</div> : null}
      {error ? <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

      {loading ? <div className="text-sm text-gray-600">加载中…</div> : null}

      {!loading && !filtered.length ? <div className="text-sm text-gray-500">暂无内容。</div> : null}

      <ul className="space-y-3">
        {filtered.map((a) => (
          <li key={a.id} className="card">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <a href={`/submit/${a.id}`} className="truncate font-semibold">
                    {a.title}
                  </a>
                  <span className="rounded bg-pink-100 px-2 py-0.5 text-xs text-pink-800">{formatStatus(a.status)}</span>
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  <span>slug：{a.slug}</span>
                  <span> · </span>
                  <span>更新：{new Date(a.updatedAt).toLocaleString()}</span>
                </div>
                {a.status === 'rejected' && a.rejectReason ? (
                  <div className="mt-2 rounded-md bg-amber-50 p-2 text-sm text-amber-900">
                    拒绝原因：{a.rejectReason}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2 sm:justify-end">
                {a.status === 'draft' || a.status === 'rejected' ? (
                  <Button type="button" disabled={actionLoading[a.id]} onClick={() => submit(a.id)}>
                    {actionLoading[a.id] ? '提交中…' : '提交审核'}
                  </Button>
                ) : null}
                {a.status === 'in_review' ? (
                  <Button type="button" variant="ghost" disabled={actionLoading[a.id]} onClick={() => withdraw(a.id)}>
                    {actionLoading[a.id] ? '撤回中…' : '撤回'}
                  </Button>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

