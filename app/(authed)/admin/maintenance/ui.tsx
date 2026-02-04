'use client'

import { useMemo, useState } from 'react'
import Button from '@/components/shared/Button'

type BackfillResult = Record<string, unknown>

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export default function MaintenanceClient() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BackfillResult | null>(null)

  const [limit, setLimit] = useState('200')
  const [cursor, setCursor] = useState('')
  const [createMissingCity, setCreateMissingCity] = useState(false)

  const limitNumber = useMemo(() => {
    const v = Number(limit)
    if (!Number.isFinite(v)) return null
    return Math.max(1, Math.min(500, Math.floor(v)))
  }, [limit])

  async function run(dryRun: boolean) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/maintenance/backfill-article-cities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dryRun,
          createMissingCity,
          limit: limitNumber ?? undefined,
          cursor: cursor.trim() || null,
        }),
      })

      const data = (await res.json().catch(() => ({}))) as any
      if (!res.ok) {
        throw new Error(String(data?.error || 'Request failed'))
      }
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  async function copyResult() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(prettyJson(result))
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">维护工具</h1>
        <p className="mt-1 text-sm text-gray-600">数据修复/回填工具（仅管理员可用）。</p>
      </div>

      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="font-semibold text-gray-900">回填文章-城市关联（ArticleCity）</h2>
          <p className="mt-1 text-sm text-gray-600">
            修复历史翻译文章缺少 ArticleCity 关联导致英文/日文城市页显示 0 篇文章的问题。
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1">
            <div className="text-xs font-medium text-gray-600">批量大小（1-500）</div>
            <input
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
              placeholder="200"
              inputMode="numeric"
            />
          </label>

          <label className="space-y-1 md:col-span-2">
            <div className="text-xs font-medium text-gray-600">cursor（可选，用于分页）</div>
            <input
              value={cursor}
              onChange={(e) => setCursor(e.target.value)}
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-mono"
              placeholder="(empty)"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={createMissingCity}
            onChange={(e) => setCreateMissingCity(e.target.checked)}
          />
          允许从 legacy city 字段自动创建缺失 City（会标记 needsReview）
        </label>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="primary" onClick={() => run(true)} disabled={loading}>
            {loading ? '运行中…' : 'Dry-run（预览）'}
          </Button>
          <Button
            type="button"
            variant="primary"
            className="bg-rose-600 hover:bg-rose-700"
            onClick={() => run(false)}
            disabled={loading}
          >
            {loading ? '运行中…' : 'Execute（执行写入）'}
          </Button>
          <Button type="button" variant="ghost" onClick={copyResult} disabled={!result}>
            复制结果 JSON
          </Button>
        </div>

        {error ? <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

        {result ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
              <div className="text-sm font-medium text-gray-700">结果</div>
              {'nextCursor' in result && result.nextCursor ? (
                <div className="text-xs text-gray-600">
                  nextCursor: <span className="font-mono">{String((result as any).nextCursor)}</span>
                </div>
              ) : null}
            </div>
            <pre className="max-h-[420px] overflow-auto p-4 text-xs leading-relaxed text-gray-800">{prettyJson(result)}</pre>
          </div>
        ) : null}
      </section>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        建议先 Dry-run 查看将要写入的数量，再执行 Execute。数据量很大时可以用 cursor 分批运行。
      </div>
    </div>
  )
}
