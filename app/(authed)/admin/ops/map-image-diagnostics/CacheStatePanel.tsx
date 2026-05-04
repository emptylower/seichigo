'use client'

import { useEffect, useRef, useState } from 'react'

const POLL_INTERVAL_MS = 30_000

type WindowKey = '1h' | '24h'

type Outcome =
  | 'cache_hit_cf'
  | 'cache_hit_r2_primary'
  | 'cache_hit_r2_fallback'
  | 'cache_miss_all'
  | 'cache_full_miss_failed'
  | 'other'

type WindowSummary = {
  total: number
  outcomes: Record<Outcome, number>
  r2HitRatio: number | null
}

type CacheStateResponse = {
  windows: Record<WindowKey, WindowSummary>
  sliTarget: number
}

const OUTCOME_LABELS: Record<Outcome, string> = {
  cache_hit_cf: 'CF 边缘命中',
  cache_hit_r2_primary: 'R2 一级命中',
  cache_hit_r2_fallback: 'R2 兜底命中',
  cache_miss_all: '上游回源',
  cache_full_miss_failed: '全失败',
  other: '其他',
}

function formatRatio(ratio: number | null): string {
  if (ratio == null) return '—'
  return `${(ratio * 100).toFixed(1)}%`
}

function formatPercent(part: number, total: number): string {
  if (total <= 0) return '—'
  return `${((part / total) * 100).toFixed(1)}%`
}

function formatServerError(data: unknown, status: number): string {
  const message = typeof data === 'object' && data && 'error' in data ? (data as { error?: unknown }).error : null
  return typeof message === 'string' && message.trim() ? message : `请求失败（${status}）`
}

export default function CacheStatePanel() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<CacheStateResponse | null>(null)
  const requestIdRef = useRef(0)

  async function loadCacheState(options?: { silent?: boolean }) {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    if (!options?.silent) {
      setLoading(true)
    }

    try {
      const res = await fetch('/api/admin/anitabi/image-mirror/cache-state', {
        method: 'GET',
        credentials: 'include',
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(formatServerError(body, res.status))
      }

      if (requestIdRef.current !== requestId) return
      setData(body as CacheStateResponse)
      setError(null)
    } catch (err) {
      if (requestIdRef.current !== requestId) return
      setError(err instanceof Error ? err.message : '加载缓存命中分布失败')
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    void loadCacheState()
    const timer = window.setInterval(() => {
      void loadCacheState({ silent: true })
    }, POLL_INTERVAL_MS)

    return () => {
      window.clearInterval(timer)
      requestIdRef.current += 1
    }
  }, [])

  const sliTarget = data?.sliTarget ?? 0.8
  const windows: WindowKey[] = ['1h', '24h']

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">缓存命中分布（§10 SLI）</h2>
          <p className="mt-1 text-sm text-gray-600">
            统计 <code className="rounded bg-gray-100 px-1 text-[11px] text-gray-700">image_cache_state</code> 事件，
            R2 命中率（primary + fallback）/ 总数 ≥ {(sliTarget * 100).toFixed(0)}% 即达到验收线。
          </p>
        </div>
      </div>

      {loading && !data ? (
        <p className="mt-4 text-sm text-gray-500">加载缓存分布…</p>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {data ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {windows.map((key) => {
            const summary = data.windows[key]
            const ratio = summary.r2HitRatio
            const meetsSli = ratio != null && ratio >= sliTarget
            return (
              <div key={key} className="rounded-lg border border-gray-200 p-3">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">最近 {key === '1h' ? '1 小时' : '24 小时'}</h3>
                  <span className="text-xs text-gray-500">{summary.total} 次</span>
                </div>
                <div className="mt-2">
                  <div className="text-2xl font-semibold text-gray-900">{formatRatio(ratio)}</div>
                  <div className={`text-xs ${meetsSli ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {ratio == null
                      ? '暂无数据'
                      : meetsSli
                        ? `达到 ≥ ${(sliTarget * 100).toFixed(0)}% 目标`
                        : `低于 ${(sliTarget * 100).toFixed(0)}% 目标`}
                  </div>
                </div>
                <ul className="mt-3 space-y-1 text-xs text-gray-600">
                  {(Object.keys(OUTCOME_LABELS) as Outcome[]).map((outcome) => (
                    <li key={outcome} className="flex items-center justify-between gap-2">
                      <span>{OUTCOME_LABELS[outcome]}</span>
                      <span className="tabular-nums">
                        {summary.outcomes[outcome]} ({formatPercent(summary.outcomes[outcome], summary.total)})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}
