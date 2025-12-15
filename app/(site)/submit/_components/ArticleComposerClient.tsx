"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@/components/shared/Button'
import RichTextEditor, { type RichTextValue } from '@/components/editor/RichTextEditor'

type ArticleStatus = 'draft' | 'in_review' | 'rejected' | 'published'

export type ArticleComposerInitial = {
  id: string
  title: string
  animeIds: string[]
  city: string | null
  routeLength: string | null
  tags: string[]
  contentJson: any | null
  contentHtml: string
  status: ArticleStatus
  rejectReason: string | null
  updatedAt: string
}

type AnimeOption = { id: string; name?: string | null }

type Props = {
  initial: ArticleComposerInitial | null
}

type SaveState = 'idle' | 'creating' | 'saving' | 'saved' | 'error'

function parseTags(input: string): string[] {
  return input
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean)
}

function countPlainText(html: string): number {
  if (!html) return 0
  const withoutTags = html.replace(/<[^>]*>/g, ' ')
  const collapsed = withoutTags.replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
  return collapsed.length
}

function formatStatus(status: ArticleStatus) {
  if (status === 'draft') return '草稿'
  if (status === 'rejected') return '被拒'
  if (status === 'in_review') return '审核中'
  return '已发布'
}

function normalizeAnimeOption(a: any): AnimeOption {
  return { id: String(a?.id || '').trim(), name: a?.name ?? null }
}

export default function ArticleComposerClient({ initial }: Props) {
  const router = useRouter()

  const [id, setId] = useState<string | null>(initial?.id ?? null)
  const [status, setStatus] = useState<ArticleStatus>(initial?.status ?? 'draft')
  const [rejectReason, setRejectReason] = useState<string | null>(initial?.rejectReason ?? null)

  const [title, setTitle] = useState(initial?.title ?? '未命名')
  const [content, setContent] = useState<RichTextValue>({
    json: initial?.contentJson ?? null,
    html: initial?.contentHtml ?? '',
  })

  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  const editable = status === 'draft' || status === 'rejected'

  const payload = useMemo(() => {
    return {
      title: title.trim() ? title.trim() : '未命名',
      contentJson: content.json,
      contentHtml: content.html,
    }
  }, [content.html, content.json, title])

  const lastSaved = useRef<string>('')
  useEffect(() => {
    if (!editable) return
    if (!id) return
    const next = JSON.stringify(payload)
    if (!next) return
    if (next === lastSaved.current) return

    setSaveState('saving')
    setSaveError(null)
    const handle = window.setTimeout(async () => {
      const res = await fetch(`/api/articles/${id}`, {
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
  }, [editable, id, payload])

  // Lazy create draft when body has any content
  useEffect(() => {
    if (initial) return
    if (id) return
    if (!editable) return
    const hasBody = countPlainText(content.html) > 0
    if (!hasBody) return
    if (saveState === 'creating') return

    setSaveState('creating')
    setSaveError(null)
    const snapshot = { ...payload }

    const handle = window.setTimeout(async () => {
      const res = await fetch('/api/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setSaveError(j.error || '创建失败')
        setSaveState('error')
        return
      }
      const j = await res.json().catch(() => null)
      const nextId = j?.article?.id ? String(j.article.id) : null
      if (!nextId) {
        setSaveError('创建失败（响应异常）')
        setSaveState('error')
        return
      }
      setId(nextId)
      router.replace(`/submit/${nextId}`)
    }, 400)

    return () => window.clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content.html, editable, id, initial, payload, router, saveState])

  const displayTitle = title === '未命名' ? '' : title

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selectedAnime, setSelectedAnime] = useState<AnimeOption[]>(
    (initial?.animeIds ?? []).map((x) => ({ id: x, name: null }))
  )
  const [animeQuery, setAnimeQuery] = useState('')
  const [animeOptions, setAnimeOptions] = useState<AnimeOption[]>([])
  const [animeLoading, setAnimeLoading] = useState(false)

  const [city, setCity] = useState(initial?.city ?? '')
  const [routeLength, setRouteLength] = useState(initial?.routeLength ?? '')
  const [tagsText, setTagsText] = useState((initial?.tags ?? []).join(', '))

  const [submitLoading, setSubmitLoading] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  async function loadAnimeOptions(q: string) {
    setAnimeLoading(true)
    const res = await fetch(`/api/anime?q=${encodeURIComponent(q)}`, { method: 'GET' })
    setAnimeLoading(false)
    const j = await res.json().catch(() => ({}))
    if (!res.ok || !j?.ok) {
      setAnimeOptions([])
      return
    }
    const items = Array.isArray(j.items) ? j.items.map(normalizeAnimeOption).filter((x: AnimeOption) => x.id) : []
    setAnimeOptions(items)
  }

  useEffect(() => {
    if (!settingsOpen) return
    void loadAnimeOptions(animeQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animeQuery, settingsOpen])

  async function onAnimeKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const q = animeQuery.trim()
    if (!q) return
    setSettingsError(null)

    const exists = selectedAnime.some((x) => x.id === q)
    if (exists) {
      setAnimeQuery('')
      return
    }

    if (animeOptions.length) {
      const first = animeOptions[0]
      if (first?.id && !selectedAnime.some((x) => x.id === first.id)) {
        setSelectedAnime((prev) => [...prev, first])
      }
      setAnimeQuery('')
      return
    }

    // create
    setAnimeLoading(true)
    const res = await fetch('/api/anime', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: q, name: q }),
    })
    setAnimeLoading(false)
    const j = await res.json().catch(() => ({}))
    if (!res.ok || !j?.ok) {
      setSettingsError(j.error || '创建作品失败')
      return
    }
    const created = normalizeAnimeOption(j.anime)
    if (created.id && !selectedAnime.some((x) => x.id === created.id)) {
      setSelectedAnime((prev) => [...prev, created])
    }
    setAnimeQuery('')
  }

  function removeAnime(id: string) {
    setSelectedAnime((prev) => prev.filter((x) => x.id !== id))
  }

  async function submitForReview() {
    if (!id) return
    setSettingsError(null)
    setFlash(null)

    const cleanedTitle = title.trim() ? title.trim() : '未命名'
    if (!cleanedTitle || cleanedTitle === '未命名') {
      setSettingsError('标题仍是“未命名”，请先修改标题')
      return
    }

    const bodyLen = countPlainText(content.html)
    if (bodyLen <= 100) {
      setSettingsError('正文内容至少需要 100 字')
      return
    }

    const animeIds = selectedAnime.map((x) => x.id).filter(Boolean)
    if (!animeIds.length) {
      setSettingsError('请至少选择一个作品')
      return
    }

    setSubmitLoading(true)
    const patchRes = await fetch(`/api/articles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        animeIds,
        city: city.trim() || null,
        routeLength: routeLength.trim() || null,
        tags: parseTags(tagsText),
      }),
    })
    if (!patchRes.ok) {
      const j = await patchRes.json().catch(() => ({}))
      setSubmitLoading(false)
      setSettingsError(j.error || '保存发布信息失败')
      return
    }

    const res = await fetch(`/api/articles/${id}/submit`, { method: 'POST' })
    setSubmitLoading(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setSettingsError(j.error || '提交失败')
      return
    }

    setSettingsOpen(false)
    setFlash('已提交审核')
    setStatus('in_review')
    setRejectReason(null)
    router.refresh()
  }

  async function withdraw() {
    if (!id) return
    setFlash(null)
    setSaveError(null)
    const res = await fetch(`/api/articles/${id}/withdraw`, { method: 'POST' })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setSaveError(j.error || '撤回失败')
      setSaveState('error')
      return
    }
    setFlash('已撤回到草稿')
    setStatus('draft')
    router.refresh()
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="flex items-center justify-between gap-4">
        <a href="/submit" className="text-sm text-gray-500 hover:text-gray-700">
          返回草稿箱
        </a>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>{formatStatus(status)}</span>
          {saveState === 'creating' ? <span>创建中…</span> : null}
          {saveState === 'saving' ? <span>保存中…</span> : null}
          {saveState === 'saved' ? <span className="text-emerald-700">已保存</span> : null}
        </div>
      </div>

      {status === 'rejected' && rejectReason ? (
        <div className="mt-6 rounded-md bg-amber-50 p-3 text-sm text-amber-900">拒绝原因：{rejectReason}</div>
      ) : null}
      {flash ? <div className="mt-6 rounded-md bg-emerald-50 p-3 text-sm text-emerald-700">{flash}</div> : null}
      {saveState === 'error' && saveError ? <div className="mt-6 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{saveError}</div> : null}

      <input
        className="mt-10 w-full bg-transparent text-4xl font-bold tracking-tight text-gray-900 outline-none placeholder:text-gray-300"
        placeholder="未命名"
        value={displayTitle}
        onChange={(e) => setTitle(e.target.value)}
        disabled={!editable || saveState === 'creating'}
      />

      <div className="mt-8">
        {editable ? (
          <RichTextEditor
            initialValue={{ json: initial?.contentJson ?? null, html: initial?.contentHtml ?? '' }}
            value={content}
            onChange={setContent}
          />
        ) : (
          <div className="prose prose-pink max-w-none" dangerouslySetInnerHTML={{ __html: initial?.contentHtml || '' }} />
        )}
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-gray-500">
          {editable ? (
            <span>提示：写作内容会自动保存；提交审核时再填写作品/标签等发布信息。</span>
          ) : (
            <span>当前状态不可编辑。</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {status === 'in_review' ? (
            <Button type="button" variant="ghost" onClick={withdraw} disabled={saveState === 'creating'}>
              撤回
            </Button>
          ) : null}
          {editable ? (
            <Button
              type="button"
              onClick={() => {
                setSettingsError(null)
                setSettingsOpen(true)
                setAnimeQuery('')
              }}
              disabled={!id || saveState === 'creating'}
            >
              提交审核
            </Button>
          ) : null}
        </div>
      </div>

      {settingsOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">发布信息</h2>
                <p className="mt-1 text-sm text-gray-600">提交审核前，请补充作品信息（必填）与可选的发布字段。</p>
              </div>
              <button
                className="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
                onClick={() => setSettingsOpen(false)}
                disabled={submitLoading}
              >
                关闭
              </button>
            </div>

            <div className="mt-4 space-y-5">
              <div>
                <label className="block text-sm font-medium">作品（必填，可多选）</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedAnime.map((a) => (
                    <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-pink-100 px-3 py-1 text-sm text-pink-800">
                      <span className="max-w-[16rem] truncate">{a.name && a.name !== a.id ? `${a.name}（${a.id}）` : a.id}</span>
                      <button
                        type="button"
                        className="ml-1 text-pink-800/70 hover:text-pink-900"
                        onClick={() => removeAnime(a.id)}
                        disabled={submitLoading}
                        aria-label={`移除作品 ${a.id}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {!selectedAnime.length ? <span className="text-sm text-gray-500">尚未选择作品</span> : null}
                </div>

                <div className="mt-3">
                  <input
                    className="w-full rounded-md border px-3 py-2"
                    placeholder="搜索或输入作品名，Enter 选择/创建"
                    value={animeQuery}
                    onChange={(e) => setAnimeQuery(e.target.value)}
                    onKeyDown={onAnimeKeyDown}
                    disabled={submitLoading}
                  />
                  <div className="mt-2 rounded-md border bg-white">
                    <div className="px-3 py-2 text-xs text-gray-500">
                      {animeLoading ? '加载中…' : animeOptions.length ? '选择一个匹配项（或继续输入）' : animeQuery.trim() ? '未找到匹配项，按 Enter 创建' : '输入关键词开始搜索'}
                    </div>
                    {animeOptions.length ? (
                      <ul className="max-h-48 overflow-auto border-t">
                        {animeOptions.map((a) => (
                          <li key={a.id}>
                            <button
                              type="button"
                              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-pink-50"
                              onClick={() => {
                                if (!selectedAnime.some((x) => x.id === a.id)) setSelectedAnime((prev) => [...prev, a])
                                setAnimeQuery('')
                              }}
                              disabled={submitLoading}
                            >
                              <span className="truncate">{a.name && a.name !== a.id ? a.name : a.id}</span>
                              <span className="shrink-0 text-xs text-gray-500">{a.id}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium">城市（可选）</label>
                  <input className="mt-2 w-full rounded-md border px-3 py-2" value={city} onChange={(e) => setCity(e.target.value)} disabled={submitLoading} />
                </div>
                <div>
                  <label className="block text-sm font-medium">用时（可选）</label>
                  <input className="mt-2 w-full rounded-md border px-3 py-2" value={routeLength} onChange={(e) => setRouteLength(e.target.value)} disabled={submitLoading} placeholder="半日 / 一日" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium">标签（可选，逗号分隔）</label>
                  <input className="mt-2 w-full rounded-md border px-3 py-2" value={tagsText} onChange={(e) => setTagsText(e.target.value)} disabled={submitLoading} placeholder="下北泽, 河堤" />
                </div>
              </div>

              {settingsError ? <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{settingsError}</div> : null}

              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setSettingsOpen(false)} disabled={submitLoading}>
                  取消
                </Button>
                <Button type="button" onClick={submitForReview} disabled={submitLoading}>
                  {submitLoading ? '提交中…' : '确认提交'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

