"use client"

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Button from '@/components/shared/Button'
import SharedCoverField from '@/components/shared/CoverField'

type AnimeDetail = {
  id: string
  name: string
  name_en?: string | null
  name_ja?: string | null
  summary?: string | null
  summary_en?: string | null
  summary_ja?: string | null
  cover?: string | null
  hidden?: boolean
}

type Tab = 'zh' | 'en' | 'ja'

type RetranslatePreview = {
  name?: string
  summary?: string
}

type AnimePatchPayload = Partial<AnimeDetail> & {
  nextId?: string
}

export default function AdminAnimeDetailClient({ id }: { id: string }) {
  const router = useRouter()
  const [anime, setAnime] = useState<AnimeDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  const [activeTab, setActiveTab] = useState<Tab>('zh')
  
  const [name, setName] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [nameJa, setNameJa] = useState('')
  
  const [summary, setSummary] = useState('')
  const [summaryEn, setSummaryEn] = useState('')
  const [summaryJa, setSummaryJa] = useState('')
  const [slugId, setSlugId] = useState('')

  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [showFailureModal, setShowFailureModal] = useState(false)
  const [failureMessage, setFailureMessage] = useState('')

  // Retranslate Modal State
  const [showRetranslateModal, setShowRetranslateModal] = useState(false)
  const [retranslatePreview, setRetranslatePreview] = useState<RetranslatePreview | null>(null)
  const [retranslateLoading, setRetranslateLoading] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    const res = await fetch(`/api/admin/anime/${encodeURIComponent(id)}`, { method: 'GET' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || 'error' in data) {
      setError(data.error || '加载失败')
      setLoading(false)
      return
    }
    setAnime(data.anime)
    setSlugId(data.anime.id || '')
    setName(data.anime.name || '')
    setNameEn(data.anime.name_en || '')
    setNameJa(data.anime.name_ja || '')
    
    setSummary(data.anime.summary || '')
    setSummaryEn(data.anime.summary_en || '')
    setSummaryJa(data.anime.summary_ja || '')
    
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [id])

  async function updateField(field: AnimePatchPayload, refreshSummary = true) {
    setSaveMessage(null)
    const res = await fetch(`/api/admin/anime/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(field),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error || '更新失败')
    }
    setAnime(data.anime)
    setSlugId(data.anime.id || '')
    
    // Update local state based on what was saved
    if (field.name !== undefined) setName(data.anime.name || '')
    if (field.name_en !== undefined) setNameEn(data.anime.name_en || '')
    if (field.name_ja !== undefined) setNameJa(data.anime.name_ja || '')
    
    if (refreshSummary) {
      if (field.summary !== undefined) setSummary(data.anime.summary || '')
      if (field.summary_en !== undefined) setSummaryEn(data.anime.summary_en || '')
      if (field.summary_ja !== undefined) setSummaryJa(data.anime.summary_ja || '')
    }
    
    setSaveMessage('已保存')
    setTimeout(() => setSaveMessage(null), 2000)
  }

  async function onSaveCurrentTab() {
    setSaving(true)
    try {
      const payload: Partial<AnimeDetail> = {}
      if (activeTab === 'zh') {
        if (!name.trim()) throw new Error('中文作品名不能为空')
        payload.name = name.trim()
        payload.summary = summary
      } else if (activeTab === 'en') {
        payload.name_en = nameEn.trim() || null
        payload.summary_en = summaryEn
      } else if (activeTab === 'ja') {
        payload.name_ja = nameJa.trim() || null
        payload.summary_ja = summaryJa
      }
      
      await updateField(payload, false) // false to prevent overwriting local summary if we want to keep typing? Actually true is safer to sync. But let's use false for now to avoid jump.
      setShowSuccessModal(true)
    } catch (err: any) {
      setFailureMessage(err.message)
      setShowFailureModal(true)
    } finally {
      setSaving(false)
    }
  }

  async function onRetranslate() {
    if (activeTab === 'zh') return // Cannot retranslate source
    
    setRetranslateLoading(true)
    try {
      const res = await fetch('/api/admin/retranslate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: 'anime',
          entityId: id,
          targetLang: activeTab
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '翻译失败')
      
      setRetranslatePreview(data.preview)
      setShowRetranslateModal(true)
    } catch (err: any) {
      alert(err.message)
    } finally {
      setRetranslateLoading(false)
    }
  }

  async function onApplyTranslation() {
    if (!retranslatePreview) return
    
    setRetranslateLoading(true)
    try {
      // Option A: Call apply API
      const res = await fetch('/api/admin/retranslate/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: 'anime',
          entityId: id,
          targetLang: activeTab,
          preview: retranslatePreview
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '应用失败')
      
      // Update local state
      if (activeTab === 'en') {
        if (retranslatePreview.name) setNameEn(retranslatePreview.name)
        if (retranslatePreview.summary) setSummaryEn(retranslatePreview.summary)
      } else if (activeTab === 'ja') {
        if (retranslatePreview.name) setNameJa(retranslatePreview.name)
        if (retranslatePreview.summary) setSummaryJa(retranslatePreview.summary)
      }
      
      setShowRetranslateModal(false)
      setSaveMessage('已应用并保存')
      setTimeout(() => setSaveMessage(null), 2000)
    } catch (err: any) {
      alert(err.message)
    } finally {
      setRetranslateLoading(false)
    }
  }

  async function onDelete() {
    if (!confirm('确定要删除（隐藏）该作品吗？前台将不再显示。')) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/anime/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('删除失败')
      const data = await res.json()
      setAnime(data.anime)
      alert('已删除（隐藏）')
    } catch (err: any) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function onRestore() {
    if (!confirm('确定要恢复显示该作品吗？')) return
    setSaving(true)
    try {
      await updateField({ hidden: false })
      alert('已恢复')
    } catch (err: any) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function onRenameId() {
    const nextId = slugId.trim().toLowerCase()
    if (!nextId || nextId === id) return
    setSaving(true)
    setSaveMessage(null)
    try {
      const res = await fetch(`/api/admin/anime/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nextId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || '更新 ID 失败')
      const updatedId = String(data?.anime?.id || '')
      if (!updatedId || updatedId === id) {
        throw new Error('更新 ID 失败（响应异常）')
      }
      router.replace(`/admin/panel/anime/${encodeURIComponent(updatedId)}`)
      router.refresh()
    } catch (err: any) {
      setFailureMessage(err.message)
      setShowFailureModal(true)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-gray-600">加载中…</div>
  if (error) return <div className="text-rose-600">{error}</div>
  if (!anime) return <div className="text-gray-600">未找到</div>

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">{anime.name}</h1>
        <div className="mt-1 flex items-center gap-2 text-sm text-gray-600">
          <Link href="/admin/panel/anime" className="hover:underline">返回列表</Link>
          <span>·</span>
          <span className="font-mono">{anime.id}</span>
          {anime.hidden ? (
            <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-600">
              已隐藏
            </span>
          ) : null}
        </div>
      </div>

      <div className="space-y-6">
        <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-gray-900">ID（URL Slug）</h2>
          <p className="text-sm text-gray-600">建议使用英文小写 + 连字符。修改时会自动迁移文章/修订里的旧 ID 引用。</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              aria-label="作品 ID (slug)"
              className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              value={slugId}
              onChange={(e) => setSlugId(e.target.value)}
              disabled={saving}
              placeholder="weathering-with-you"
            />
            <Button
              type="button"
              onClick={onRenameId}
              disabled={saving || !slugId.trim() || slugId.trim().toLowerCase() === id}
            >
              更新 ID
            </Button>
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-gray-900">封面</h2>
          <SharedCoverField
            value={anime.cover ?? null}
            onChange={(next) => setAnime((prev) => (prev ? { ...prev, cover: next ?? undefined } : prev))}
            onSave={async (url) => {
              await updateField({ cover: url ?? null }, false)
            }}
            aspectRatio={3 / 4}
            label="作品海报"
            description="建议上传竖版海报（3:4 比例）"
          />
        </section>

        <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-gray-200 px-6">
            <nav className="-mb-px flex space-x-6" aria-label="Tabs">
              {(['zh', 'en', 'ja'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`
                    whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm
                    ${activeTab === tab
                      ? 'border-brand-500 text-brand-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }
                  `}
                >
                  {tab === 'zh' ? '中文 (Original)' : tab === 'en' ? 'English' : '日本語'}
                </button>
              ))}
            </nav>
          </div>

          <div className="p-6 space-y-6">
            {activeTab === 'zh' ? (
              <>
                <div className="space-y-2">
                  <label htmlFor="name-zh" className="block text-sm font-medium text-gray-700">作品名 (中文)</label>
                  <input
                    id="name-zh"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={saving}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="summary-zh" className="block text-sm font-medium text-gray-700">简介 (中文)</label>
                  <textarea
                    id="summary-zh"
                    className="h-32 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    disabled={saving}
                  />
                </div>
              </>
            ) : activeTab === 'en' ? (
              <>
                <div className="space-y-2">
                  <label htmlFor="name-en" className="block text-sm font-medium text-gray-700">Name (English)</label>
                  <input
                    id="name-en"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    value={nameEn}
                    onChange={(e) => setNameEn(e.target.value)}
                    disabled={saving}
                    placeholder="Enter English name..."
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="summary-en" className="block text-sm font-medium text-gray-700">Summary (English)</label>
                  <textarea
                    id="summary-en"
                    className="h-32 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    value={summaryEn}
                    onChange={(e) => setSummaryEn(e.target.value)}
                    disabled={saving}
                    placeholder="Enter English summary..."
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <label htmlFor="name-ja" className="block text-sm font-medium text-gray-700">作品名 (日本語)</label>
                  <input
                    id="name-ja"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    value={nameJa}
                    onChange={(e) => setNameJa(e.target.value)}
                    disabled={saving}
                    placeholder="日本語の作品名..."
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="summary-ja" className="block text-sm font-medium text-gray-700">あらすじ (日本語)</label>
                  <textarea
                    id="summary-ja"
                    className="h-32 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    value={summaryJa}
                    onChange={(e) => setSummaryJa(e.target.value)}
                    disabled={saving}
                    placeholder="あらすじを入力..."
                  />
                </div>
              </>
            )}

            <div className="flex items-center justify-between pt-4 border-t border-gray-100">
              <div className="flex items-center gap-4">
                <span className="text-sm text-emerald-600 min-h-[20px]">{saveMessage}</span>
                {activeTab !== 'zh' ? (
                  <Button variant="ghost" onClick={onRetranslate} disabled={saving || retranslateLoading}>
                    {retranslateLoading ? '翻译中…' : 'AI 重新翻译'}
                  </Button>
                ) : null}
              </div>
              <Button onClick={onSaveCurrentTab} disabled={saving}>
                {saving ? '保存中…' : '保存当前语言'}
              </Button>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-gray-50 p-6">
          <h2 className="font-semibold text-gray-900">危险区域</h2>
          <div className="mt-4">
            {anime.hidden ? (
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600">该作品已被隐藏。</p>
                <Button onClick={onRestore} disabled={saving}>
                  恢复显示
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600">隐藏后，该作品将不再显示在索引页。</p>
                <Button variant="ghost" className="border-rose-300 text-rose-700 hover:bg-rose-50" onClick={onDelete} disabled={saving}>
                  删除（隐藏）
                </Button>
              </div>
            )}
          </div>
        </section>
      </div>

      {showSuccessModal ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="flex w-full max-w-sm flex-col overflow-hidden rounded-xl bg-white shadow-xl">
            <div className="px-6 py-6 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900">保存成功</h3>
              <p className="mt-2 text-sm text-gray-600">内容已更新。</p>
            </div>
            <div className="flex border-t bg-gray-50 px-6 py-4">
              <Button 
                className="w-full justify-center" 
                onClick={() => setShowSuccessModal(false)}
              >
                确定
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {showFailureModal ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="flex w-full max-w-sm flex-col overflow-hidden rounded-xl bg-white shadow-xl">
            <div className="px-6 py-6 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900">保存失败</h3>
              <p className="mt-2 text-sm text-gray-600">{failureMessage || '发生未知错误'}</p>
            </div>
            <div className="flex border-t bg-gray-50 px-6 py-4">
              <Button 
                variant="ghost" 
                className="w-full justify-center" 
                onClick={() => setShowFailureModal(false)}
              >
                关闭
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {showRetranslateModal && retranslatePreview ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-xl max-h-[90vh]">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-900">AI 翻译预览 ({activeTab})</h3>
              <button onClick={() => setShowRetranslateModal(false)} className="text-gray-500 hover:text-gray-700">×</button>
            </div>
            <div className="px-6 py-6 overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-4">
                  <h4 className="font-medium text-gray-500">原文 (中文)</h4>
                  <div className="space-y-2">
                    <div className="text-xs font-mono text-gray-400">Name</div>
                    <div className="p-2 bg-gray-50 rounded text-sm">{name}</div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs font-mono text-gray-400">Summary</div>
                    <div className="p-2 bg-gray-50 rounded text-sm whitespace-pre-wrap">{summary}</div>
                  </div>
                </div>
                <div className="space-y-4">
                  <h4 className="font-medium text-brand-600">AI 翻译结果</h4>
                  <div className="space-y-2">
                    <div className="text-xs font-mono text-gray-400">Name</div>
                    <div className="p-2 bg-blue-50 rounded text-sm">{retranslatePreview.name}</div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs font-mono text-gray-400">Summary</div>
                    <div className="p-2 bg-blue-50 rounded text-sm whitespace-pre-wrap">{retranslatePreview.summary}</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex border-t bg-gray-50 px-6 py-4 gap-3 justify-end">
              <Button 
                variant="ghost" 
                onClick={() => setShowRetranslateModal(false)}
              >
                取消
              </Button>
              <Button 
                onClick={onApplyTranslation}
                disabled={retranslateLoading}
              >
                {retranslateLoading ? '应用中…' : '应用翻译'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
