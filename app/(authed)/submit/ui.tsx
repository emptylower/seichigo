"use client"

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
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
type Action = 'submit' | 'withdraw' | 'delete' | 'revise'

function formatStatus(status: ArticleListItem['status']) {
  if (status === 'draft') return '草稿'
  if (status === 'rejected') return '被拒'
  if (status === 'in_review') return '审核中'
  return '已发布'
}

function formatDateTime(input: string) {
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) return input
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  }).format(d)
}

export default function SubmitCenterClient({ user }: Props) {
  const router = useRouter()
  const [items, setItems] = useState<ArticleListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('draftbox')
  const [actionLoading, setActionLoading] = useState<Record<string, Action | null>>({})

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
    setActionLoading((m) => ({ ...m, [id]: 'submit' }))
    const res = await fetch(`/api/articles/${id}/submit`, { method: 'POST' })
    setActionLoading((m) => ({ ...m, [id]: null }))
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
    setActionLoading((m) => ({ ...m, [id]: 'withdraw' }))
    const res = await fetch(`/api/articles/${id}/withdraw`, { method: 'POST' })
    setActionLoading((m) => ({ ...m, [id]: null }))
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error || '撤回失败')
      return
    }
    setFlash('已撤回到草稿')
    await load()
  }

  async function deleteDraft(id: string) {
    setFlash(null)
    setError(null)
    if (!window.confirm('确定删除这篇草稿吗？此操作不可撤销。')) return

    setActionLoading((m) => ({ ...m, [id]: 'delete' }))
    const res = await fetch(`/api/articles/${id}`, { method: 'DELETE' })
    setActionLoading((m) => ({ ...m, [id]: null }))
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error || '删除失败')
      return
    }
    setFlash('已删除')
    await load()
  }

  async function startRevision(articleId: string) {
    setFlash(null)
    setError(null)
    setActionLoading((m) => ({ ...m, [articleId]: 'revise' }))
    const res = await fetch(`/api/articles/${articleId}/revision`, { method: 'POST' })
    setActionLoading((m) => ({ ...m, [articleId]: null }))
    const j = await res.json().catch(() => ({}))
    if (!res.ok || !j?.ok) {
      setError(j.error || '发起更新失败')
      return
    }
    const revisionId = j?.revision?.id ? String(j.revision.id) : ''
    if (!revisionId) {
      setError('发起更新失败（响应异常）')
      return
    }
    router.push(`/submit/revisions/${revisionId}`)
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
                  <span>更新：{formatDateTime(a.updatedAt)}</span>
                </div>
                {a.status === 'rejected' && a.rejectReason ? (
                  <div className="mt-2 rounded-md bg-amber-50 p-2 text-sm text-amber-900">
                    拒绝原因：{a.rejectReason}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2 sm:justify-end">
                {a.status === 'draft' || a.status === 'rejected' ? (
                  <>
                    <Button type="button" disabled={actionLoading[a.id] != null} onClick={() => submit(a.id)}>
                      {actionLoading[a.id] === 'submit' ? '提交中…' : '提交审核'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="border-rose-300 text-rose-700 hover:bg-rose-50"
                      disabled={actionLoading[a.id] != null}
                      onClick={() => deleteDraft(a.id)}
                    >
                      {actionLoading[a.id] === 'delete' ? '删除中…' : '删除'}
                    </Button>
                  </>
                ) : null}
                {a.status === 'in_review' ? (
                  <Button type="button" variant="ghost" disabled={actionLoading[a.id] != null} onClick={() => withdraw(a.id)}>
                    {actionLoading[a.id] === 'withdraw' ? '撤回中…' : '撤回'}
                  </Button>
                ) : null}
                {a.status === 'published' ? (
                  <Button type="button" disabled={actionLoading[a.id] != null} onClick={() => startRevision(a.id)}>
                    {actionLoading[a.id] === 'revise' ? '处理中…' : '发起更新'}
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
