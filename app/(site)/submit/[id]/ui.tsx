"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import Button from '@/components/shared/Button'
import RichTextEditor, { type RichTextValue } from '@/components/editor/RichTextEditor'

type ArticleStatus = 'draft' | 'in_review' | 'rejected' | 'published'

type Article = {
  id: string
  slug: string
  title: string
  animeId: string | null
  city: string | null
  routeLength: string | null
  tags: string[]
  contentJson: any | null
  contentHtml: string
  status: ArticleStatus
  rejectReason: string | null
  updatedAt: string
}

function parseTags(input: string): string[] {
  return input
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean)
}

function formatStatus(status: ArticleStatus) {
  if (status === 'draft') return '草稿'
  if (status === 'rejected') return '被拒'
  if (status === 'in_review') return '审核中'
  return '已发布'
}

export default function ArticleEditorClient({ initial }: { initial: Article }) {
  const [status, setStatus] = useState<ArticleStatus>(initial.status)
  const [slug, setSlug] = useState(initial.slug)
  const [title, setTitle] = useState(initial.title)
  const [animeId, setAnimeId] = useState(initial.animeId ?? '')
  const [city, setCity] = useState(initial.city ?? '')
  const [routeLength, setRouteLength] = useState(initial.routeLength ?? '')
  const [tagsText, setTagsText] = useState((initial.tags || []).join(', '))
  const [rejectReason, setRejectReason] = useState(initial.rejectReason)

  const [content, setContent] = useState<RichTextValue>({
    json: initial.contentJson ?? null,
    html: initial.contentHtml ?? '',
  })

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const editable = status === 'draft' || status === 'rejected'

  const payload = useMemo(() => {
    return {
      slug,
      title,
      animeId: animeId.trim() || null,
      city: city.trim() || null,
      routeLength: routeLength.trim() || null,
      tags: parseTags(tagsText),
      contentJson: content.json,
      contentHtml: content.html,
    }
  }, [animeId, city, content.html, content.json, routeLength, slug, tagsText, title])

  const lastSaved = useRef<string>('')
  useEffect(() => {
    if (!editable) return
    const next = JSON.stringify(payload)
    if (!next) return
    if (next === lastSaved.current) return

    setSaveState('saving')
    setSaveError(null)
    const handle = window.setTimeout(async () => {
      const res = await fetch(`/api/articles/${initial.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setSaveError(j.error || '保存失败')
        setSaveState('error')
        return
      }
      lastSaved.current = next
      setSaveState('saved')
      window.setTimeout(() => setSaveState('idle'), 1200)
    }, 800)

    return () => window.clearTimeout(handle)
  }, [editable, initial.id, payload])

  async function doSubmit() {
    setActionLoading('submit')
    const res = await fetch(`/api/articles/${initial.id}/submit`, { method: 'POST' })
    setActionLoading(null)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setSaveError(j.error || '提交失败')
      setSaveState('error')
      return
    }
    setStatus('in_review')
    setRejectReason(null)
    window.location.reload()
  }

  async function doWithdraw() {
    setActionLoading('withdraw')
    const res = await fetch(`/api/articles/${initial.id}/withdraw`, { method: 'POST' })
    setActionLoading(null)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setSaveError(j.error || '撤回失败')
      setSaveState('error')
      return
    }
    setStatus('draft')
    window.location.reload()
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">编辑文章</h1>
          <div className="text-sm text-gray-600">
            <span className="rounded bg-pink-100 px-2 py-0.5 text-xs text-pink-800">{formatStatus(status)}</span>
            <span className="ml-2 text-xs text-gray-500">更新：{new Date(initial.updatedAt).toLocaleString()}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" onClick={() => (window.location.href = '/submit')}>
            返回列表
          </Button>
          {editable ? (
            <Button type="button" disabled={actionLoading === 'submit'} onClick={doSubmit}>
              {actionLoading === 'submit' ? '提交中…' : '提交审核'}
            </Button>
          ) : null}
          {status === 'in_review' ? (
            <Button type="button" variant="ghost" disabled={actionLoading === 'withdraw'} onClick={doWithdraw}>
              {actionLoading === 'withdraw' ? '撤回中…' : '撤回'}
            </Button>
          ) : null}
        </div>
      </header>

      {status === 'rejected' && rejectReason ? (
        <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">拒绝原因：{rejectReason}</div>
      ) : null}

      {saveState === 'saving' ? <div className="text-xs text-gray-500">保存中…</div> : null}
      {saveState === 'saved' ? <div className="text-xs text-emerald-700">已保存</div> : null}
      {saveState === 'error' && saveError ? <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{saveError}</div> : null}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium">slug（URL）</label>
          <input
            className="mt-1 w-full rounded-md border px-3 py-2"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            disabled={!editable}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium">标题</label>
          <input
            className="mt-1 w-full rounded-md border px-3 py-2"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={!editable}
          />
        </div>
        <div>
          <label className="block text-sm font-medium">animeId（可选）</label>
          <input
            className="mt-1 w-full rounded-md border px-3 py-2"
            value={animeId}
            onChange={(e) => setAnimeId(e.target.value)}
            disabled={!editable}
            placeholder="btr"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">城市（可选）</label>
          <input
            className="mt-1 w-full rounded-md border px-3 py-2"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            disabled={!editable}
            placeholder="东京"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">用时（可选）</label>
          <input
            className="mt-1 w-full rounded-md border px-3 py-2"
            value={routeLength}
            onChange={(e) => setRouteLength(e.target.value)}
            disabled={!editable}
            placeholder="一日"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium">标签（逗号分隔）</label>
          <input
            className="mt-1 w-full rounded-md border px-3 py-2"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            disabled={!editable}
            placeholder="下北泽, 河堤"
          />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">正文</h2>
        {editable ? (
          <RichTextEditor
            initialValue={{ json: initial.contentJson ?? null, html: initial.contentHtml ?? '' }}
            value={content}
            onChange={setContent}
          />
        ) : (
          <div className="rounded-md border bg-white p-4">
            <div className="text-sm text-gray-600">当前状态不可编辑。若需修改，请先撤回/重新提交。</div>
            <div className="mt-4" dangerouslySetInnerHTML={{ __html: initial.contentHtml || '' }} />
          </div>
        )}
      </section>
    </div>
  )
}
