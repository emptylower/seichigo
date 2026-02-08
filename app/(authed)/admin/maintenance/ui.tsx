'use client'

import { useMemo, useRef, useState } from 'react'
import Button from '@/components/shared/Button'
import { useAdminToast } from '@/hooks/useAdminToast'

type BackfillResult = Record<string, unknown>

type BackfillApiResult = {
  ok?: boolean
  dryRun?: boolean
  createMissingCity?: boolean
  limit?: number
  cursor?: string | null
  nextCursor?: string | null
  scanned?: number
  processed?: number
  errors?: number
  totalCandidates?: number
} & Record<string, unknown>

type ProgressState = {
  mode: 'dryRun' | 'execute'
  running: boolean
  cancelled: boolean
  scanned: number
  processed: number
  failed: number
  total: number | null
  nextCursor: string | null
  startedAt: number
  finishedAt: number | null
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function toInt(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.floor(parsed) : 0
}

export default function MaintenanceClient() {
  const toast = useAdminToast()
  const cancelRef = useRef(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BackfillResult | null>(null)
  const [progress, setProgress] = useState<ProgressState | null>(null)

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
    setResult(null)

    const mode: ProgressState['mode'] = dryRun ? 'dryRun' : 'execute'
    const startCursor = cursor.trim() || null
    const aggregate = {
      scanned: 0,
      processed: 0,
      failed: 0,
      total: null as number | null,
      nextCursor: startCursor as string | null,
    }

    cancelRef.current = false
    setProgress({
      mode,
      running: true,
      cancelled: false,
      scanned: 0,
      processed: 0,
      failed: 0,
      total: null,
      nextCursor: startCursor,
      startedAt: Date.now(),
      finishedAt: null,
    })

    let lastChunk: BackfillApiResult | null = null
    let loopCursor = startCursor

    try {
      for (let i = 0; i < 10_000; i += 1) {
        if (cancelRef.current) break

        const res = await fetch('/api/admin/maintenance/backfill-article-cities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dryRun,
            createMissingCity,
            limit: limitNumber ?? undefined,
            cursor: loopCursor,
          }),
        })

        const data = (await res.json().catch(() => ({}))) as BackfillApiResult
        if (!res.ok) {
          throw new Error(String(data?.error || 'Request failed'))
        }

        lastChunk = data

        const scanned = toInt(data.scanned)
        const processed = toInt(data.processed)
        const errors = toInt(data.errors)
        const totalCandidates = Number.isFinite(Number(data.totalCandidates))
          ? Number(data.totalCandidates)
          : null

        aggregate.scanned += scanned
        aggregate.processed += processed
        aggregate.failed += errors
        if (aggregate.total == null && totalCandidates != null) {
          aggregate.total = totalCandidates
        }

        loopCursor = typeof data.nextCursor === 'string' && data.nextCursor.trim() ? data.nextCursor : null
        aggregate.nextCursor = loopCursor

        setProgress((prev) =>
          prev
            ? {
                ...prev,
                scanned: aggregate.scanned,
                processed: aggregate.processed,
                failed: aggregate.failed,
                total: aggregate.total,
                nextCursor: aggregate.nextCursor,
              }
            : prev
        )

        if (!loopCursor) break
      }

      const cancelled = cancelRef.current
      const mergedResult: BackfillResult = {
        ...(lastChunk || {}),
        ok: true,
        aggregated: true,
        cancelled,
        dryRun,
        createMissingCity,
        limit: limitNumber ?? undefined,
        cursor: startCursor,
        nextCursor: aggregate.nextCursor,
        scanned: aggregate.scanned,
        processed: aggregate.processed,
        errors: aggregate.failed,
        totalCandidates: aggregate.total,
      }

      setResult(mergedResult)
      setProgress((prev) =>
        prev
          ? {
              ...prev,
              running: false,
              cancelled,
              finishedAt: Date.now(),
              scanned: aggregate.scanned,
              processed: aggregate.processed,
              failed: aggregate.failed,
              total: aggregate.total,
              nextCursor: aggregate.nextCursor,
            }
          : prev
      )

      if (!dryRun) {
        if (cancelled) {
          toast.info(
            `已中断：已处理 ${aggregate.processed} / ${aggregate.total ?? '-'}，失败 ${aggregate.failed}，nextCursor=${aggregate.nextCursor ?? '-'}`,
            '回填任务已中断'
          )
        } else if (aggregate.failed > 0) {
          toast.error(`回填执行完成（有错误）：processed=${aggregate.processed}, failed=${aggregate.failed}`)
        } else {
          toast.success(`回填执行成功：processed=${aggregate.processed}, failed=${aggregate.failed}`)
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Request failed'
      setError(msg)
      setResult(null)
      setProgress((prev) =>
        prev
          ? {
              ...prev,
              running: false,
              cancelled: false,
              finishedAt: Date.now(),
            }
          : prev
      )

      if (!dryRun) {
        toast.error(`回填执行失败：${msg}`)
      }
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
          <Button type="button" variant="primary" onClick={() => void run(true)} disabled={loading}>
            {loading ? '运行中…' : 'Dry-run（预览）'}
          </Button>
          <Button
            type="button"
            variant="primary"
            className="bg-rose-600 hover:bg-rose-700"
            onClick={() => void run(false)}
            disabled={loading}
          >
            {loading ? '运行中…' : 'Execute（执行写入）'}
          </Button>
          <Button type="button" variant="ghost" onClick={copyResult} disabled={!result}>
            复制结果 JSON
          </Button>
        </div>

        {progress ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-900">执行进度</div>
                <div className="mt-1 text-sm text-gray-700">
                  已处理 / 总数：{progress.processed} / {progress.total ?? '-'}，失败：{progress.failed}
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  已扫描：{progress.scanned} · 状态：
                  {progress.running ? '执行中' : progress.cancelled ? '已中断' : '已完成'}
                  {progress.nextCursor ? ` · nextCursor=${progress.nextCursor}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {progress.running ? (
                  <Button type="button" variant="ghost" onClick={() => { cancelRef.current = true }}>
                    中断执行
                  </Button>
                ) : (
                  <Button type="button" variant="ghost" onClick={() => setProgress(null)}>
                    清除进度
                  </Button>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {error ? <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

        {result ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
              <div className="text-sm font-medium text-gray-700">结果</div>
              {typeof (result as any).nextCursor === 'string' && (result as any).nextCursor ? (
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
        建议先 Dry-run 查看将要写入的数量，再执行 Execute。数据量很大时可中断并使用 nextCursor 继续。
      </div>
    </div>
  )
}
