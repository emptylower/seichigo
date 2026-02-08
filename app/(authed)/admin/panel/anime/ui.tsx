"use client"

import Link from 'next/link'
import { useEffect, useState } from 'react'
import Button from '@/components/shared/Button'

type AnimeItem = {
  id: string
  name: string
  alias?: string[]
  hidden?: boolean
}

type ListResponse =
  | { ok: true; items: AnimeItem[]; total?: number; page?: number; pageSize?: number; hasMore?: boolean }
  | { error: string }

type Props = {
  initialItems: AnimeItem[]
  initialPage: number
  initialPageSize: number
  initialTotal: number
  initialQuery: string
}

export default function AdminAnimeListClient({
  initialItems,
  initialPage,
  initialPageSize,
  initialTotal,
  initialQuery,
}: Props) {
  const [items, setItems] = useState<AnimeItem[]>(initialItems)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState(initialQuery)
  const [page, setPage] = useState(initialPage)
  const [pageSize] = useState(initialPageSize)
  const [total, setTotal] = useState(initialTotal)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [nextId, setNextId] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)

  async function load(query: string = q, targetPage: number = 1) {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (query.trim()) params.set('q', query.trim())
    params.set('page', String(targetPage))
    params.set('pageSize', String(pageSize))
    const res = await fetch(`/api/admin/anime?${params.toString()}`, { method: 'GET' })
    const data = (await res.json().catch(() => ({}))) as ListResponse
    if (!res.ok || 'error' in data) {
      setError(('error' in data && data.error) || '加载失败')
      setItems([])
      setTotal(0)
      setLoading(false)
      return
    }
    setItems(data.items || [])
    setTotal(typeof data.total === 'number' ? data.total : (data.items || []).length)
    setPage(typeof data.page === 'number' && Number.isFinite(data.page) ? data.page : targetPage)
    setLoading(false)
  }

  useEffect(() => {
    setItems(initialItems)
    setPage(initialPage)
    setTotal(initialTotal)
    setError(null)
  }, [initialItems, initialPage, initialTotal])

  function onSearch(e: React.FormEvent) {
    e.preventDefault()
    void load(q, 1)
  }

  function prevPage() {
    if (loading || page <= 1) return
    void load(q, page - 1)
  }

  function nextPage() {
    if (loading) return
    const hasMore = page * pageSize < total
    if (!hasMore) return
    void load(q, page + 1)
  }

  function openRenameModal(id: string) {
    setRenamingId(id)
    setNextId(id)
    setRenameError(null)
  }

  function closeRenameModal() {
    if (renameBusy) return
    setRenamingId(null)
    setRenameError(null)
    setNextId('')
  }

  async function submitRename() {
    if (!renamingId) return
    const target = nextId.trim().toLowerCase()
    if (!target || target === renamingId) {
      setRenameError('请输入新的作品 ID')
      return
    }
    setRenameBusy(true)
    setRenameError(null)
    const res = await fetch(`/api/admin/anime/${encodeURIComponent(renamingId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nextId: target }),
    })
    const data = await res.json().catch(() => ({}))
    setRenameBusy(false)
    if (!res.ok) {
      setRenameError(data.error || '更新 ID 失败')
      return
    }
    setRenamingId(null)
    setNextId('')
    await load(q, page)
  }

  const hasMore = page * pageSize < total
  const startNo = total > 0 ? (page - 1) * pageSize + 1 : 0
  const endNo = total > 0 ? Math.min(total, page * pageSize) : 0

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">作品管理</h1>
        <p className="mt-1 text-sm text-gray-600">
          <Link href="/admin/panel" className="hover:underline">返回面板</Link>
          {' · '}
          管理作品元数据（ID、封面、简介、显隐）。
        </p>
      </div>

      <form onSubmit={onSearch} className="flex gap-2">
        <input
          className="w-full max-w-xs rounded-md border px-3 py-2 text-sm"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索 ID / 名称 / 别名"
        />
        <Button type="submit" disabled={loading}>搜索</Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
        <span>
          共 {total} 条，当前第 {page} 页（{startNo}-{endNo}）
        </span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" disabled={loading || page <= 1} onClick={prevPage}>
            上一页
          </Button>
          <Button type="button" variant="ghost" disabled={loading || !hasMore} onClick={nextPage}>
            下一页
          </Button>
        </div>
      </div>

      {loading ? <div className="text-gray-600">加载中…</div> : null}
      {error ? <div className="rounded-md bg-rose-50 p-3 text-rose-700">{error}</div> : null}

      {!loading && !error ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((a) => (
            <li key={a.id} className={`card ${a.hidden ? 'opacity-60 bg-gray-50' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <Link href={`/admin/panel/anime/${encodeURIComponent(a.id)}`} className="font-semibold hover:underline">
                  {a.name}
                </Link>
                {a.hidden ? (
                  <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-600">
                    已隐藏
                  </span>
                ) : null}
              </div>
              <div className="mt-1 text-xs text-gray-500 font-mono">{a.id}</div>
              {a.alias?.length ? (
                <div className="mt-1 truncate text-xs text-gray-400">
                  {a.alias.join(' / ')}
                </div>
              ) : null}
              <div className="mt-2 flex items-center gap-3 text-xs">
                <button
                  type="button"
                  className="text-brand-700 hover:text-brand-800 disabled:text-gray-400"
                  onClick={() => openRenameModal(a.id)}
                  disabled={loading}
                >
                  改 ID
                </button>
                <Link href={`/admin/panel/anime/${encodeURIComponent(a.id)}`} className="text-gray-500 hover:text-gray-700">
                  编辑详情
                </Link>
              </div>
            </li>
          ))}
          {!items.length && <li className="text-gray-500 col-span-full">暂无匹配作品。</li>}
        </ul>
      ) : null}

      {renamingId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold">修改作品 ID</h2>
            <p className="mt-1 text-sm text-gray-600">
              当前：<span className="font-mono">{renamingId}</span>
            </p>
            <p className="mt-1 text-xs text-gray-500">仅支持小写英文、数字、连字符；会自动迁移文章/修订中的旧 ID。</p>
            <input
              aria-label="新的作品 ID"
              className="mt-3 w-full rounded-md border px-3 py-2 font-mono text-sm"
              value={nextId}
              onChange={(e) => setNextId(e.target.value)}
              disabled={renameBusy}
              placeholder="weathering-with-you"
            />
            {renameError ? (
              <div className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{renameError}</div>
            ) : null}
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeRenameModal} disabled={renameBusy}>
                取消
              </Button>
              <Button type="button" onClick={() => void submitRename()} disabled={renameBusy}>
                {renameBusy ? '更新中…' : '确认更新 ID'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
