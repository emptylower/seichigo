"use client"

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import Button from '@/components/shared/Button'
import CoverField from '@/components/shared/CoverField'

type CityAlias = {
  id: string
  alias: string
  langCode?: string | null
  isPrimary?: boolean
}

type CityDetail = {
  id: string
  slug: string
  name_zh: string
  name_en?: string | null
  name_ja?: string | null
  description_zh?: string | null
  description_en?: string | null
  description_ja?: string | null
  transportTips_zh?: string | null
  transportTips_en?: string | null
  transportTips_ja?: string | null
  cover?: string | null
  needsReview?: boolean
  hidden?: boolean
  aliases: CityAlias[]
}

type DetailResponse = { ok: true; city: CityDetail } | { error: string }

type Tab = 'zh' | 'en' | 'ja'

type RetranslatePreview = {
  name?: string
  description?: string
  transportTips?: string
}

export default function AdminCityDetailClient({ id }: { id: string }) {
  const [city, setCity] = useState<CityDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<Tab>('zh')

  const [nameZh, setNameZh] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [nameJa, setNameJa] = useState('')

  const [descZh, setDescZh] = useState('')
  const [descEn, setDescEn] = useState('')
  const [descJa, setDescJa] = useState('')

  const [tipsZh, setTipsZh] = useState('')
  const [tipsEn, setTipsEn] = useState('')
  const [tipsJa, setTipsJa] = useState('')

  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  const [aliasDraft, setAliasDraft] = useState('')
  const [mergeTarget, setMergeTarget] = useState('')

  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [showFailureModal, setShowFailureModal] = useState(false)
  const [failureMessage, setFailureMessage] = useState('')

  const [showRetranslateModal, setShowRetranslateModal] = useState(false)
  const [retranslatePreview, setRetranslatePreview] = useState<RetranslatePreview | null>(null)
  const [retranslateLoading, setRetranslateLoading] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    const res = await fetch(`/api/admin/city/${encodeURIComponent(id)}`, { method: 'GET' })
    const data = (await res.json().catch(() => ({}))) as DetailResponse
    if (!res.ok || 'error' in data) {
      setError(('error' in data && data.error) || '加载失败')
      setLoading(false)
      return
    }
    setCity(data.city)
    
    setNameZh(data.city.name_zh || '')
    setNameEn(data.city.name_en || '')
    setNameJa(data.city.name_ja || '')
    
    setDescZh(data.city.description_zh || '')
    setDescEn(data.city.description_en || '')
    setDescJa(data.city.description_ja || '')
    
    setTipsZh(data.city.transportTips_zh || '')
    setTipsEn(data.city.transportTips_en || '')
    setTipsJa(data.city.transportTips_ja || '')
    
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [id])

  async function patchCity(patch: Partial<CityDetail>, refreshFields = true) {
    setSaving(true)
    setSaveMessage(null)
    try {
      const res = await fetch(`/api/admin/city/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) throw new Error(data?.error || '保存失败')
      
      const updatedCity = data.city
      setCity(updatedCity)
      
      if (refreshFields) {
        if (patch.name_zh !== undefined) setNameZh(updatedCity.name_zh || '')
        if (patch.name_en !== undefined) setNameEn(updatedCity.name_en || '')
        if (patch.name_ja !== undefined) setNameJa(updatedCity.name_ja || '')
        
        if (patch.description_zh !== undefined) setDescZh(updatedCity.description_zh || '')
        if (patch.description_en !== undefined) setDescEn(updatedCity.description_en || '')
        if (patch.description_ja !== undefined) setDescJa(updatedCity.description_ja || '')
        
        if (patch.transportTips_zh !== undefined) setTipsZh(updatedCity.transportTips_zh || '')
        if (patch.transportTips_en !== undefined) setTipsEn(updatedCity.transportTips_en || '')
        if (patch.transportTips_ja !== undefined) setTipsJa(updatedCity.transportTips_ja || '')
      }
      
      setSaveMessage('已保存')
      setTimeout(() => setSaveMessage(null), 1500)
    } finally {
      setSaving(false)
    }
  }

  async function onSaveCurrentTab() {
    setSaving(true)
    try {
      const payload: Partial<CityDetail> = {}
      if (activeTab === 'zh') {
        if (!nameZh.trim()) throw new Error('中文名不能为空')
        payload.name_zh = nameZh.trim()
        payload.description_zh = descZh
        payload.transportTips_zh = tipsZh
      } else if (activeTab === 'en') {
        payload.name_en = nameEn.trim() || null
        payload.description_en = descEn
        payload.transportTips_en = tipsEn
      } else if (activeTab === 'ja') {
        payload.name_ja = nameJa.trim() || null
        payload.description_ja = descJa
        payload.transportTips_ja = tipsJa
      }
      
      await patchCity(payload, false)
      setShowSuccessModal(true)
    } catch (err: any) {
      setFailureMessage(err.message)
      setShowFailureModal(true)
    } finally {
      setSaving(false)
    }
  }

  async function onRetranslate() {
    if (activeTab === 'zh') return
    
    setRetranslateLoading(true)
    try {
      const res = await fetch('/api/admin/retranslate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: 'city',
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
      const res = await fetch('/api/admin/retranslate/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: 'city',
          entityId: id,
          targetLang: activeTab,
          preview: retranslatePreview
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '应用失败')
      
      if (activeTab === 'en') {
        if (retranslatePreview.name) setNameEn(retranslatePreview.name)
        if (retranslatePreview.description) setDescEn(retranslatePreview.description)
        if (retranslatePreview.transportTips) setTipsEn(retranslatePreview.transportTips)
      } else if (activeTab === 'ja') {
        if (retranslatePreview.name) setNameJa(retranslatePreview.name)
        if (retranslatePreview.description) setDescJa(retranslatePreview.description)
        if (retranslatePreview.transportTips) setTipsJa(retranslatePreview.transportTips)
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

  async function addAlias() {
    const cleaned = aliasDraft.trim()
    if (!cleaned) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/city/${encodeURIComponent(id)}/aliases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: cleaned }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) throw new Error(data?.error || '添加失败')
      setAliasDraft('')
      await load()
    } catch (e: any) {
      alert(e?.message || '添加失败')
    } finally {
      setSaving(false)
    }
  }

  async function removeAlias(aliasId: string) {
    if (!confirm('确定删除该别名吗？')) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/city/${encodeURIComponent(id)}/aliases/${encodeURIComponent(aliasId)}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) throw new Error(data?.error || '删除失败')
      await load()
    } catch (e: any) {
      alert(e?.message || '删除失败')
    } finally {
      setSaving(false)
    }
  }

  async function merge() {
    const target = mergeTarget.trim()
    if (!target) return
    if (!confirm('确定要合并吗？合并后本城市将被隐藏，并建立跳转。')) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/city/${encodeURIComponent(id)}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetCityId: target }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) throw new Error(data?.error || '合并失败')
      alert('合并完成（本城市已隐藏）')
      await load()
    } catch (e: any) {
      alert(e?.message || '合并失败')
    } finally {
      setSaving(false)
    }
  }

  const aliases = useMemo(() => (city?.aliases || []).slice(), [city?.aliases])

  if (loading) return <div className="text-gray-600">加载中…</div>
  if (error) return <div className="text-rose-600">{error}</div>
  if (!city) return <div className="text-gray-600">未找到</div>

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">{city.name_zh}</h1>
        <div className="mt-1 flex items-center gap-2 text-sm text-gray-600">
          <Link href="/admin/panel/city" className="hover:underline">返回列表</Link>
          <span>·</span>
          <span className="font-mono">{city.id}</span>
          <span>·</span>
          <span className="font-mono">{city.slug}</span>
          {city.needsReview ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">待完善</span> : null}
          {city.hidden ? <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-600">已隐藏</span> : null}
        </div>
        {saveMessage ? <div className="mt-2 text-sm text-emerald-700">{saveMessage}</div> : null}
      </div>

      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="font-semibold text-gray-900">封面</h2>
        <CoverField
          value={city.cover ?? null}
          onChange={(next) => setCity((prev) => (prev ? { ...prev, cover: next ?? null } : prev))}
          onSave={async (url) => {
            await patchCity({ cover: url ?? null }, false)
          }}
          aspectRatio={4 / 3}
          label="城市封面"
          description="建议上传横图（4:3）"
          disabled={saving}
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
                <label className="block text-sm font-medium text-gray-700">中文名</label>
                <input
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  value={nameZh}
                  onChange={(e) => setNameZh(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">中文简介</label>
                <textarea
                  className="min-h-24 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  value={descZh}
                  onChange={(e) => setDescZh(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">交通小贴士 (中文)</label>
                <textarea
                  className="min-h-20 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  value={tipsZh}
                  onChange={(e) => setTipsZh(e.target.value)}
                  disabled={saving}
                />
              </div>
            </>
          ) : activeTab === 'en' ? (
            <>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">English Name</label>
                <input
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  value={nameEn}
                  onChange={(e) => setNameEn(e.target.value)}
                  disabled={saving}
                  placeholder="Enter English name..."
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Description (English)</label>
                <textarea
                  className="min-h-24 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  value={descEn}
                  onChange={(e) => setDescEn(e.target.value)}
                  disabled={saving}
                  placeholder="Enter English description..."
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Transport Tips (English)</label>
                <textarea
                  className="min-h-20 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  value={tipsEn}
                  onChange={(e) => setTipsEn(e.target.value)}
                  disabled={saving}
                  placeholder="Enter English transport tips..."
                />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">都市名 (日本語)</label>
                <input
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  value={nameJa}
                  onChange={(e) => setNameJa(e.target.value)}
                  disabled={saving}
                  placeholder="日本語の都市名..."
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">紹介 (日本語)</label>
                <textarea
                  className="min-h-24 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  value={descJa}
                  onChange={(e) => setDescJa(e.target.value)}
                  disabled={saving}
                  placeholder="紹介を入力..."
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">交通アクセス (日本語)</label>
                <textarea
                  className="min-h-20 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  value={tipsJa}
                  onChange={(e) => setTipsJa(e.target.value)}
                  disabled={saving}
                  placeholder="交通アクセスを入力..."
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
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(city.hidden)}
                  onChange={(e) => {
                    const next = e.target.checked
                    setCity((prev) => (prev ? { ...prev, hidden: next } : prev))
                    void patchCity({ hidden: next }, false)
                  }}
                  disabled={saving}
                />
                隐藏城市
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(city.needsReview)}
                  onChange={(e) => {
                    const next = e.target.checked
                    setCity((prev) => (prev ? { ...prev, needsReview: next } : prev))
                    void patchCity({ needsReview: next }, false)
                  }}
                  disabled={saving}
                />
                待完善
              </label>
              <Button onClick={onSaveCurrentTab} disabled={saving}>
                {saving ? '保存中…' : '保存当前语言'}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="font-semibold text-gray-900">别名</h2>
        <div className="flex gap-2">
          <input
            className="w-full rounded-md border px-3 py-2 text-sm"
            value={aliasDraft}
            onChange={(e) => setAliasDraft(e.target.value)}
            placeholder="新增别名（例如：东京 / Tokyo / 東京都）"
            disabled={saving}
          />
          <Button type="button" onClick={() => void addAlias()} disabled={saving || !aliasDraft.trim()}>
            添加
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {aliases.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
              <span className="max-w-[18rem] truncate">{a.alias}</span>
              {a.isPrimary ? <span className="text-xs text-gray-500">(主)</span> : null}
              <button
                type="button"
                className="ml-1 text-gray-500 hover:text-gray-700"
                onClick={() => void removeAlias(a.id)}
                disabled={saving}
              >
                ×
              </button>
            </span>
          ))}
          {!aliases.length ? <span className="text-sm text-gray-500">暂无别名。</span> : null}
        </div>
      </section>

      <section className="rounded-xl border border-rose-200 bg-rose-50 p-6">
        <h2 className="font-semibold text-rose-800">危险区域：合并城市</h2>
        <p className="mt-2 text-sm text-rose-700">
          输入目标城市 ID（cuid），合并后当前城市将被隐藏，并建立 slug 跳转。
        </p>
        <div className="mt-3 flex gap-2">
          <input
            className="w-full rounded-md border border-rose-200 bg-white px-3 py-2 text-sm"
            value={mergeTarget}
            onChange={(e) => setMergeTarget(e.target.value)}
            placeholder="targetCityId"
            disabled={saving}
          />
          <Button type="button" className="border-rose-300 text-rose-800 hover:bg-rose-100" variant="ghost" onClick={() => void merge()} disabled={saving || !mergeTarget.trim()}>
            合并
          </Button>
        </div>
      </section>

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
              <h3 className="text-lg font-semibold text-gray-900">AI 翻译预览 ({activeTab.toUpperCase()})</h3>
              <button onClick={() => setShowRetranslateModal(false)} className="text-gray-500 hover:text-gray-700">×</button>
            </div>
            <div className="px-6 py-6 overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-4">
                  <h4 className="font-medium text-gray-500">原文 (中文)</h4>
                  <div className="space-y-2">
                    <div className="text-xs font-mono text-gray-400">Name</div>
                    <div className="p-2 bg-gray-50 rounded text-sm">{nameZh}</div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs font-mono text-gray-400">Description</div>
                    <div className="p-2 bg-gray-50 rounded text-sm whitespace-pre-wrap">{descZh}</div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs font-mono text-gray-400">Transport Tips</div>
                    <div className="p-2 bg-gray-50 rounded text-sm whitespace-pre-wrap">{tipsZh}</div>
                  </div>
                </div>
                <div className="space-y-4">
                  <h4 className="font-medium text-brand-600">AI 翻译结果</h4>
                  <div className="space-y-2">
                    <div className="text-xs font-mono text-gray-400">Name</div>
                    <div className="p-2 bg-blue-50 rounded text-sm">{retranslatePreview.name}</div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs font-mono text-gray-400">Description</div>
                    <div className="p-2 bg-blue-50 rounded text-sm whitespace-pre-wrap">{retranslatePreview.description}</div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs font-mono text-gray-400">Transport Tips</div>
                    <div className="p-2 bg-blue-50 rounded text-sm whitespace-pre-wrap">{retranslatePreview.transportTips}</div>
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
                {retranslateLoading ? '应用中…' : '应用翻译 (保存)'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
