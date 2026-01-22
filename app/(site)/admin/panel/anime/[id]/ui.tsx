"use client"

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Button from '@/components/shared/Button'
import SharedCoverField from '@/components/shared/CoverField'

type AnimeDetail = {
  id: string
  name: string
  summary?: string | null
  cover?: string | null
  hidden?: boolean
}

export default function AdminAnimeDetailClient({ id }: { id: string }) {
  const router = useRouter()
  const [anime, setAnime] = useState<AnimeDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  const [name, setName] = useState('')
  const [summary, setSummary] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [showFailureModal, setShowFailureModal] = useState(false)
  const [failureMessage, setFailureMessage] = useState('')

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
    setName(data.anime.name || '')
    setSummary(data.anime.summary || '')
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [id])

  async function updateField(field: Partial<AnimeDetail>, refreshSummary = true) {
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
    if (refreshSummary) {
      setSummary(data.anime.summary || '')
    }
    setSaveMessage('已保存')
    setTimeout(() => setSaveMessage(null), 2000)
  }

  async function onSaveSummary() {
    setSaving(true)
    try {
      await updateField({ summary })
      setShowSuccessModal(true)
    } catch (err: any) {
      setFailureMessage(err.message)
      setShowFailureModal(true)
    } finally {
      setSaving(false)
    }
  }

  async function onSaveName() {
    const trimmed = name.trim()
    if (!trimmed) {
      setFailureMessage('作品名不能为空')
      setShowFailureModal(true)
      return
    }
    setSaving(true)
    try {
      await updateField({ name: trimmed }, false)
      setName(trimmed)
    } catch (err: any) {
      setFailureMessage(err.message)
      setShowFailureModal(true)
    } finally {
      setSaving(false)
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

        <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-gray-900">作品名</h2>
          <div className="space-y-2">
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:bg-gray-50 disabled:text-gray-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="请输入作品名…"
              disabled={saving}
            />
            <div className="flex items-center justify-between">
              <span className="text-sm text-emerald-600 min-h-[20px]">{saveMessage}</span>
              <Button onClick={onSaveName} disabled={saving}>
                {saving ? '保存中…' : '保存作品名'}
              </Button>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-gray-900">简介</h2>
          <div className="space-y-2">
            <textarea
              className="h-32 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:bg-gray-50 disabled:text-gray-500"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="请输入作品简介…"
              disabled={saving}
            />
            <div className="flex items-center justify-between">
              <span className="text-sm text-emerald-600 min-h-[20px]">{saveMessage}</span>
              <Button onClick={onSaveSummary} disabled={saving}>
                {saving ? '保存中…' : '保存简介'}
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
              <p className="mt-2 text-sm text-gray-600">作品简介已更新。</p>
            </div>
            <div className="flex border-t bg-gray-50 px-6 py-4">
              <Button 
                className="w-full justify-center" 
                onClick={() => router.push('/admin/panel')}
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
    </div>
  )
}
