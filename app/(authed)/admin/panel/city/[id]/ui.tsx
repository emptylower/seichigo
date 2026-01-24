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
  transportTips_zh?: string | null
  transportTips_en?: string | null
  cover?: string | null
  needsReview?: boolean
  hidden?: boolean
  aliases: CityAlias[]
}

type DetailResponse = { ok: true; city: CityDetail } | { error: string }

export default function AdminCityDetailClient({ id }: { id: string }) {
  const [city, setCity] = useState<CityDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  const [aliasDraft, setAliasDraft] = useState('')
  const [mergeTarget, setMergeTarget] = useState('')

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
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [id])

  async function patchCity(patch: Partial<CityDetail>) {
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
      setCity(data.city)
      setSaveMessage('已保存')
      setTimeout(() => setSaveMessage(null), 1500)
    } finally {
      setSaving(false)
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
            await patchCity({ cover: url ?? null })
          }}
          aspectRatio={4 / 3}
          label="城市封面"
          description="建议上传横图（4:3）"
          disabled={saving}
        />
      </section>

      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="font-semibold text-gray-900">基本信息</h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium">中文名</label>
            <input
              className="mt-2 w-full rounded-md border px-3 py-2 text-sm"
              value={city.name_zh}
              onChange={(e) => setCity((prev) => (prev ? { ...prev, name_zh: e.target.value } : prev))}
              disabled={saving}
            />
          </div>
          <div>
            <label className="block text-sm font-medium">英文名</label>
            <input
              className="mt-2 w-full rounded-md border px-3 py-2 text-sm"
              value={city.name_en ?? ''}
              onChange={(e) => setCity((prev) => (prev ? { ...prev, name_en: e.target.value } : prev))}
              disabled={saving}
            />
          </div>
          <div>
            <label className="block text-sm font-medium">日文名</label>
            <input
              className="mt-2 w-full rounded-md border px-3 py-2 text-sm"
              value={city.name_ja ?? ''}
              onChange={(e) => setCity((prev) => (prev ? { ...prev, name_ja: e.target.value } : prev))}
              disabled={saving}
            />
          </div>
          <div className="flex items-end gap-2">
            <Button
              type="button"
              onClick={() =>
                void patchCity({
                  name_zh: city.name_zh,
                  name_en: city.name_en ?? null,
                  name_ja: city.name_ja ?? null,
                  needsReview: Boolean(city.needsReview),
                  hidden: Boolean(city.hidden),
                })
              }
              disabled={saving || !city.name_zh.trim()}
            >
              {saving ? '保存中…' : '保存'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void patchCity({ needsReview: false })}
              disabled={saving || !city.needsReview}
            >
              标记已完善
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="block text-sm font-medium">中文简介</label>
            <textarea
              className="mt-2 min-h-24 w-full resize-y rounded-md border px-3 py-2 text-sm"
              value={city.description_zh ?? ''}
              onChange={(e) => setCity((prev) => (prev ? { ...prev, description_zh: e.target.value } : prev))}
              disabled={saving}
            />
          </div>
          <div>
            <label className="block text-sm font-medium">交通小贴士（中文）</label>
            <textarea
              className="mt-2 min-h-20 w-full resize-y rounded-md border px-3 py-2 text-sm"
              value={city.transportTips_zh ?? ''}
              onChange={(e) => setCity((prev) => (prev ? { ...prev, transportTips_zh: e.target.value } : prev))}
              disabled={saving}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(city.hidden)}
                onChange={(e) => setCity((prev) => (prev ? { ...prev, hidden: e.target.checked } : prev))}
                disabled={saving}
              />
              隐藏城市
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(city.needsReview)}
                onChange={(e) => setCity((prev) => (prev ? { ...prev, needsReview: e.target.checked } : prev))}
                disabled={saving}
              />
              待完善
            </label>
            <Button
              type="button"
              onClick={() =>
                void patchCity({
                  description_zh: city.description_zh ?? null,
                  transportTips_zh: city.transportTips_zh ?? null,
                  hidden: Boolean(city.hidden),
                  needsReview: Boolean(city.needsReview),
                })
              }
              disabled={saving}
            >
              {saving ? '保存中…' : '保存扩展信息'}
            </Button>
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
    </div>
  )
}
