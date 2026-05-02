'use client'

import { useEffect, useState } from 'react'
import Button from '@/components/shared/Button'
import type {
  MapImageDiagConfigResponse,
  MapImageDiagDetailResponse,
  MapImageDiagEvent,
  MapImageDiagListItem,
  MapImageDiagListResponse,
  MapImageDiagOverviewResponse,
  MapImageDiagSessionDetail,
} from './types'
import {
  boolLabel,
  formatDateTime,
  formatDuration,
  formatPercent,
  prettyJson,
  statusColor,
  toDateTimeLocalValue,
  truncateMiddle,
} from './utils'
import { HorizontalBarList, MetricCard, TimelineBars } from './widgets'

const LIST_LIMIT = 20
const RANGE_PRESETS = [
  { id: '1h' as const, label: '最近 1 小时' },
  { id: '6h' as const, label: '最近 6 小时' },
  { id: '24h' as const, label: '最近 24 小时' },
  { id: '7d' as const, label: '最近 7 天' },
]

export default function AdminMapImageDiagnosticsUi() {
  const [configLoading, setConfigLoading] = useState(true)
  const [configError, setConfigError] = useState<string | null>(null)
  const [configWarning, setConfigWarning] = useState<string | null>(null)
  const [fullCaptureEnabled, setFullCaptureEnabled] = useState(false)
  const [configUpdatedAt, setConfigUpdatedAt] = useState<string | null>(null)
  const [toggleSaving, setToggleSaving] = useState(false)
  const [deleteSaving, setDeleteSaving] = useState(false)
  const [purgeSaving, setPurgeSaving] = useState(false)
  const [rangePreset, setRangePreset] = useState<'1h' | '6h' | '24h' | '7d' | 'custom'>('24h')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [overviewLoading, setOverviewLoading] = useState(true)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [overviewWarning, setOverviewWarning] = useState<string | null>(null)
  const [overview, setOverview] = useState<Extract<MapImageDiagOverviewResponse, { ok: true }> | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listWarning, setListWarning] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [items, setItems] = useState<MapImageDiagListItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [session, setSession] = useState<MapImageDiagSessionDetail | null>(null)
  const [events, setEvents] = useState<MapImageDiagEvent[]>([])

  function buildRangeParams() {
    const params = new URLSearchParams()
    if (rangePreset === 'custom') {
      if (customStart) params.set('start', new Date(customStart).toISOString())
      if (customEnd) params.set('end', new Date(customEnd).toISOString())
    } else {
      params.set('preset', rangePreset)
    }
    return params
  }

  function persistForceCaptureOverride(enabled: boolean) {
    try {
      window.localStorage.setItem('seichigo_map_image_diag_force', enabled ? '1' : '0')
    } catch {
      // ignore
    }
    document.cookie = `seichigo_map_image_diag_force=${enabled ? '1' : '0'}; path=/; max-age=31536000; samesite=lax`
  }

  function readForceCaptureOverride(): boolean {
    try {
      const localValue = window.localStorage.getItem('seichigo_map_image_diag_force')
      if (localValue === '1' || localValue === 'true') return true
    } catch {
      // ignore
    }
    const cookieMatch = document.cookie.match(/(?:^|;\s*)seichigo_map_image_diag_force=([^;]+)/)
    const cookieValue = cookieMatch?.[1]?.trim().toLowerCase()
    return cookieValue === '1' || cookieValue === 'true'
  }

  async function loadConfig() {
    setConfigLoading(true)
    setConfigError(null)
    try {
      const res = await fetch('/api/admin/ops/map-image-diagnostics/config', { method: 'GET' })
      const data = (await res.json().catch(() => ({}))) as MapImageDiagConfigResponse
      if (!res.ok || !('ok' in data && data.ok)) {
        throw new Error(('error' in data && data.error) || `Request failed (${res.status})`)
      }
      setFullCaptureEnabled(readForceCaptureOverride() || Boolean(data.config.fullCaptureEnabled))
      setConfigUpdatedAt(data.config.updatedAt)
      setConfigWarning(('warning' in data && data.warning) ? data.warning : null)
    } catch (err) {
      setConfigWarning(null)
      setConfigError(err instanceof Error ? err.message : '加载全量扫描配置失败')
    } finally {
      setConfigLoading(false)
    }
  }

  async function updateFullCapture(nextValue: boolean) {
    setToggleSaving(true)
    setConfigError(null)
    try {
      const res = await fetch('/api/admin/ops/map-image-diagnostics/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullCaptureEnabled: nextValue }),
      })
      const data = (await res.json().catch(() => ({}))) as MapImageDiagConfigResponse
      if (!res.ok || !('ok' in data && data.ok)) {
        throw new Error(('error' in data && data.error) || `Request failed (${res.status})`)
      }
      setFullCaptureEnabled(Boolean(data.config.fullCaptureEnabled))
      setConfigUpdatedAt(data.config.updatedAt)
      persistForceCaptureOverride(Boolean(data.config.fullCaptureEnabled))
      setConfigWarning(('warning' in data && data.warning) ? data.warning : null)
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : '更新全量扫描配置失败')
    } finally {
      setToggleSaving(false)
    }
  }

  async function loadOverview() {
    setOverviewLoading(true)
    setOverviewError(null)
    try {
      const params = buildRangeParams()
      const res = await fetch(`/api/admin/ops/map-image-diagnostics/overview?${params.toString()}`, { method: 'GET' })
      const data = (await res.json().catch(() => ({}))) as MapImageDiagOverviewResponse
      if (!res.ok || !('ok' in data && data.ok)) {
        throw new Error(('error' in data && data.error) || `Request failed (${res.status})`)
      }
      setOverview(data)
      setOverviewWarning(('warning' in data && data.warning) ? data.warning : null)
      if (rangePreset !== 'custom') {
        setCustomStart(toDateTimeLocalValue(data.range.start))
        setCustomEnd(toDateTimeLocalValue(data.range.end))
      }
    } catch (err) {
      setOverview(null)
      setOverviewWarning(null)
      setOverviewError(err instanceof Error ? err.message : '加载总览失败')
    } finally {
      setOverviewLoading(false)
    }
  }

  async function loadList(options?: { cursor?: string | null; append?: boolean }) {
    const append = Boolean(options?.append)
    if (append) {
      setLoadingMore(true)
    } else {
      setLoading(true)
      setError(null)
      setListWarning(null)
    }

    try {
      const params = buildRangeParams()
      params.set('limit', String(LIST_LIMIT))
      if (options?.cursor) params.set('cursor', options.cursor)

      const res = await fetch(`/api/admin/ops/map-image-diagnostics?${params.toString()}`, { method: 'GET' })
      const data = (await res.json().catch(() => ({}))) as MapImageDiagListResponse
      if (!res.ok || !('ok' in data && data.ok)) {
        throw new Error(('error' in data && data.error) || `Request failed (${res.status})`)
      }

      setItems((prev) => (append ? [...prev, ...data.items] : data.items))
      setNextCursor(data.nextCursor || null)
      setListWarning(('warning' in data && data.warning) ? data.warning : null)
      if (!append && selectedId && !data.items.some((item) => item.id === selectedId)) {
        setSelectedId(null)
        setSession(null)
        setEvents([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载诊断列表失败')
      if (!append) {
        setItems([])
        setNextCursor(null)
      }
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  async function loadDetail(sessionId: string) {
    setSelectedId(sessionId)
    setDetailLoading(true)
    setDetailError(null)
    try {
      const res = await fetch(`/api/admin/ops/map-image-diagnostics/${encodeURIComponent(sessionId)}`, { method: 'GET' })
      const data = (await res.json().catch(() => ({}))) as MapImageDiagDetailResponse
      if (!res.ok || !('ok' in data && data.ok)) {
        throw new Error(('error' in data && data.error) || `Request failed (${res.status})`)
      }
      setSession(data.session)
      setEvents(data.events || [])
    } catch (err) {
      setSession(null)
      setEvents([])
      setDetailError(err instanceof Error ? err.message : '加载诊断详情失败')
    } finally {
      setDetailLoading(false)
    }
  }

  async function copyDetailJson() {
    if (!session) return
    try {
      await navigator.clipboard.writeText(prettyJson({ session, events }))
    } catch {
      // ignore clipboard failures
    }
  }

  async function deleteSelectedSession() {
    if (!selectedId || !window.confirm('确定删除当前选中的诊断会话吗？')) return
    setDeleteSaving(true)
    try {
      const res = await fetch(`/api/admin/ops/map-image-diagnostics/${encodeURIComponent(selectedId)}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !(data as any)?.ok) {
        throw new Error(String((data as any)?.error || `Request failed (${res.status})`))
      }
      setSelectedId(null)
      setSession(null)
      setEvents([])
      await Promise.all([loadOverview(), loadList()])
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : '删除诊断会话失败')
    } finally {
      setDeleteSaving(false)
    }
  }

  async function purgeCurrentRange() {
    if (!window.confirm('确定删除当前时间范围内的诊断记录吗？此操作不可撤销。')) return
    setPurgeSaving(true)
    try {
      const body = rangePreset === 'custom'
        ? {
            start: customStart ? new Date(customStart).toISOString() : null,
            end: customEnd ? new Date(customEnd).toISOString() : null,
          }
        : overview?.range
          ? {
              start: overview.range.start,
              end: overview.range.end,
            }
          : { start: null, end: null }
      const res = await fetch('/api/admin/ops/map-image-diagnostics/purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !(data as any)?.ok) {
        throw new Error(String((data as any)?.error || `Request failed (${res.status})`))
      }
      setSelectedId(null)
      setSession(null)
      setEvents([])
      await Promise.all([loadOverview(), loadList()])
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除当前范围记录失败')
    } finally {
      setPurgeSaving(false)
    }
  }

  useEffect(() => {
    void loadConfig()
  }, [])

  useEffect(() => {
    if (rangePreset === 'custom') return
    void Promise.all([loadOverview(), loadList()])
  }, [rangePreset])

  const totalSessions = overview?.totals.sessions || 0
  const degradedSessions = overview?.totals.degradedSessions || 0

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">地图图片诊断</h1>
          <p className="mt-1 text-sm text-gray-600">查看 map / nearby 图片链路的诊断会话与事件时间线。</p>
          <p className="mt-2 text-xs text-gray-500">开启全量扫描后，新打开的地图页会默认持续记录链路历史。</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/admin/ops"
            className="inline-flex items-center justify-center rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            返回运维检查
          </a>
          <Button type="button" variant="ghost" onClick={() => void loadList()} disabled={loading || detailLoading}>
            刷新列表
          </Button>
        </div>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">链路监测总览</h2>
            <p className="mt-1 text-sm text-gray-600">查看最近选定时间范围内的快慢、退化与加载结果分布。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {RANGE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setRangePreset(preset.id)}
                className={`rounded-md border px-3 py-1.5 text-sm transition ${
                  rangePreset === preset.id
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setRangePreset('custom')}
              className={`rounded-md border px-3 py-1.5 text-sm transition ${
                rangePreset === 'custom'
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              自定义
            </button>
          </div>
        </div>

        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-gray-900">全量扫描</div>
              <div className="mt-1 text-xs text-gray-500">
                开启后，新的地图图片链路将默认全量记录，不再依赖 10% 抽样。
                {configUpdatedAt ? ` 最近更新：${formatDateTime(configUpdatedAt)}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-xs ${fullCaptureEnabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-white text-gray-600'}`}>
                {fullCaptureEnabled ? '已开启' : '已关闭'}
              </span>
              <Button
                type="button"
                variant={fullCaptureEnabled ? 'ghost' : 'primary'}
                onClick={() => void updateFullCapture(!fullCaptureEnabled)}
                disabled={toggleSaving || configLoading}
              >
                {toggleSaving ? '保存中…' : fullCaptureEnabled ? '关闭全量扫描' : '开启全量扫描'}
              </Button>
            </div>
          </div>
          {configError ? <div className="mt-3 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{configError}</div> : null}
          {configWarning ? <div className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-700">{configWarning}</div> : null}
        </div>

        {rangePreset === 'custom' ? (
          <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <label className="space-y-1">
              <div className="text-xs font-medium text-gray-600">开始时间</div>
              <input
                type="datetime-local"
                value={customStart}
                onChange={(event) => setCustomStart(event.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1">
              <div className="text-xs font-medium text-gray-600">结束时间</div>
              <input
                type="datetime-local"
                value={customEnd}
                onChange={(event) => setCustomEnd(event.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <div className="flex items-end">
              <Button type="button" variant="ghost" onClick={() => void Promise.all([loadOverview(), loadList()])}>
                应用时间范围
              </Button>
            </div>
          </div>
        ) : null}

        {overviewWarning ? <div className="mb-3 rounded-md bg-amber-50 p-3 text-sm text-amber-700">{overviewWarning}</div> : null}
        {overviewError ? <div className="mb-3 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{overviewError}</div> : null}
        {overviewLoading ? <div className="text-sm text-gray-600">加载总览中…</div> : null}

        {overview ? (
          <div className="space-y-6">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <MetricCard label="会话总数" value={String(overview.totals.sessions)} helper={`${formatDateTime(overview.range.start)} → ${formatDateTime(overview.range.end)}`} />
              <MetricCard label="退化会话" value={String(overview.totals.degradedSessions)} helper={formatPercent(overview.totals.degradedSessions, overview.totals.sessions)} />
              <MetricCard label="失败 / Fallback" value={`${overview.totals.failureSessions} / ${overview.totals.fallbackSessions}`} />
              <MetricCard label="平均耗时" value={formatDuration(overview.totals.avgDurationMs)} helper={`P95 ${formatDuration(overview.totals.p95DurationMs)}`} />
              <MetricCard label="Proxy / 采样" value={`${overview.totals.proxySessions} / ${overview.totals.sampledSessions}`} />
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr_1fr]">
              <section className="space-y-3 rounded-lg border border-gray-200 p-4">
                <div>
                  <h3 className="font-medium text-gray-900">时间趋势</h3>
                  <p className="mt-1 text-xs text-gray-500">绿色是总会话，红色是退化会话。</p>
                </div>
                <TimelineBars rows={overview.timeline} />
              </section>

              <section className="space-y-3 rounded-lg border border-gray-200 p-4">
                <div>
                  <h3 className="font-medium text-gray-900">会话结果分布</h3>
                  <p className="mt-1 text-xs text-gray-500">看最近窗口内的加载结局。</p>
                </div>
                <HorizontalBarList
                  rows={overview.outcomes}
                  total={totalSessions}
                  colorClass="bg-brand-500"
                  formatRight={(count) => `${count} · ${formatPercent(count, totalSessions)}`}
                />
              </section>

              <section className="space-y-3 rounded-lg border border-gray-200 p-4">
                <div>
                  <h3 className="font-medium text-gray-900">耗时分桶</h3>
                  <p className="mt-1 text-xs text-gray-500">看最近窗口内链路快慢区间。</p>
                </div>
                <HorizontalBarList
                  rows={overview.durationBuckets}
                  total={overview.durationBuckets.reduce((sum, row) => sum + row.count, 0)}
                  colorClass="bg-emerald-500"
                />
              </section>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
              <section className="space-y-3 rounded-lg border border-gray-200 p-4">
                <div>
                  <h3 className="font-medium text-gray-900">阶段热点</h3>
                  <p className="mt-1 text-xs text-gray-500">优先看退化次数最多的阶段。</p>
                </div>
                <div className="space-y-3">
                  {overview.stageStats.length === 0 ? (
                    <div className="text-sm text-gray-500">当前时间范围内暂无阶段数据。</div>
                  ) : overview.stageStats.map((row) => (
                    <div key={row.stage} className="rounded-md border border-gray-200 p-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="font-mono text-xs text-gray-900">{row.stage}</div>
                        <div className="text-xs text-gray-500">{row.degradedCount}/{row.count}</div>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-rose-400"
                          style={{ width: `${row.count > 0 ? Math.max(6, Math.round((row.degradedCount / row.count) * 100)) : 0}%` }}
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-gray-500">
                        <span>平均 {formatDuration(row.avgDurationMs)}</span>
                        <span>P95 {formatDuration(row.p95DurationMs)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-3 rounded-lg border border-gray-200 p-4">
                <div>
                  <h3 className="font-medium text-gray-900">最近会话快照</h3>
                  <p className="mt-1 text-xs text-gray-500">给页面和机器接口共用的一组最近窗口快照。</p>
                </div>
                <div className="space-y-2">
                  {overview.recentSessions.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => void loadDetail(item.id)}
                      className="block w-full rounded-md border border-gray-200 p-3 text-left transition hover:border-brand-300"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-mono text-xs text-gray-900">{item.id}</div>
                          <div className="mt-1 text-[11px] text-gray-500">{formatDateTime(item.createdAt)}</div>
                        </div>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusColor(item.sessionOutcome)}`}>
                          {item.sessionOutcome}
                        </span>
                      </div>
                      <div className="mt-2 text-[11px] text-gray-500">
                        {item.surface} · {item.firstDegradedStage || '无退化'} · {item.eventCount} events
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </div>
        ) : null}
      </section>

      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-gray-900">诊断会话</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">{items.length} 条</span>
              <Button type="button" variant="ghost" onClick={() => void purgeCurrentRange()} disabled={purgeSaving}>
                {purgeSaving ? '删除中…' : '删除当前范围'}
              </Button>
            </div>
          </div>

          {listWarning ? <div className="mb-3 rounded-md bg-amber-50 p-3 text-sm text-amber-700">{listWarning}</div> : null}
          {error ? <div className="mb-3 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
          {loading ? <div className="text-sm text-gray-600">加载中…</div> : null}

          <div className="space-y-3">
            {items.map((item) => {
              const active = item.id === selectedId
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void loadDetail(item.id)}
                  className={`block w-full rounded-lg border p-3 text-left transition ${
                    active ? 'border-brand-400 bg-brand-50/40' : 'border-gray-200 hover:border-brand-300'
                  }`}
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs text-gray-900">{item.id}</div>
                      <div className="mt-1 text-xs text-gray-500">{formatDateTime(item.createdAt)}</div>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusColor(item.sessionOutcome)}`}>
                      {item.sessionOutcome}
                    </span>
                  </div>
                  <div className="grid gap-1 text-xs text-gray-600">
                    <div>surface: {item.surface}</div>
                    <div>{boolLabel(item.sampled)}{item.escalationReason ? ` · ${item.escalationReason}` : ''}</div>
                    <div>首个退化阶段: {item.firstDegradedStage || '-'}</div>
                    <div>事件数: {item.eventCount}</div>
                  </div>
                </button>
              )
            })}
          </div>

          {nextCursor ? (
            <div className="mt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => void loadList({ cursor: nextCursor, append: true })}
                disabled={loadingMore}
              >
                {loadingMore ? '加载中…' : '加载更多'}
              </Button>
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">会话详情</h2>
              <p className="mt-1 text-xs text-gray-500">按时间顺序查看 chain / request / terminal 事件。</p>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={() => void copyDetailJson()} disabled={!session}>
                复制 JSON
              </Button>
              <Button type="button" variant="ghost" onClick={() => void deleteSelectedSession()} disabled={!session || deleteSaving}>
                {deleteSaving ? '删除中…' : '删除当前会话'}
              </Button>
            </div>
          </div>

          {detailError ? <div className="mb-3 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{detailError}</div> : null}
          {detailLoading ? <div className="text-sm text-gray-600">加载详情中…</div> : null}

          {!detailLoading && !session ? (
            <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
              选择左侧会话以查看时间线。
            </div>
          ) : null}

          {session ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="text-xs text-gray-500">会话 ID</div>
                  <div className="mt-1 break-all font-mono text-xs text-gray-900">{session.id}</div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="text-xs text-gray-500">surface / outcome</div>
                  <div className="mt-1 text-sm font-semibold text-gray-900">{session.surface} / {session.sessionOutcome}</div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="text-xs text-gray-500">采样 / 升级</div>
                  <div className="mt-1 text-sm text-gray-900">{boolLabel(session.sampled)}{session.escalationReason ? ` · ${session.escalationReason}` : ''}</div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="text-xs text-gray-500">首个退化阶段 / 事件数</div>
                  <div className="mt-1 text-sm text-gray-900">{session.firstDegradedStage || '-'} / {session.eventCount}</div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="text-xs text-gray-500">最后终态 / Proxy</div>
                  <div className="mt-1 text-sm text-gray-900">
                    {session.lastTerminalState || '-'} / {session.proxyInvolved ? 'yes' : 'no'}
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border border-gray-200">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-xs">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">时间</th>
                        <th className="px-3 py-2 text-left font-medium">阶段</th>
                        <th className="px-3 py-2 text-left font-medium">chain / request</th>
                        <th className="px-3 py-2 text-left font-medium">slot / owner</th>
                        <th className="px-3 py-2 text-left font-medium">terminal</th>
                        <th className="px-3 py-2 text-left font-medium">URL</th>
                        <th className="px-3 py-2 text-left font-medium">evidence</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {events.map((event) => (
                        <tr key={event.id} className="align-top">
                          <td className="px-3 py-2 whitespace-nowrap text-gray-600">{formatDateTime(event.createdAt)}</td>
                          <td className="px-3 py-2 text-gray-900">
                            <div className="font-medium">{event.stage}</div>
                            <div className="mt-1 text-gray-500">
                              #{event.attemptIndex} · c{event.candidateIndex}/{event.candidateCount}
                            </div>
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-gray-700">
                            <div>{truncateMiddle(event.chainId, 12, 10)}</div>
                            <div className="mt-1">{truncateMiddle(event.requestId, 12, 10)}</div>
                          </td>
                          <td className="px-3 py-2 text-gray-700">
                            <div>{event.slotKey}</div>
                            <div className="mt-1 text-gray-500">{event.owner} · {event.slotType}</div>
                          </td>
                          <td className="px-3 py-2 text-gray-700">
                            <div>{event.terminalState || '-'}</div>
                            <div className="mt-1 text-gray-500">
                              {event.displayOutcome || '-'}{event.durationMs != null ? ` · ${event.durationMs}ms` : ''}
                            </div>
                            <div className="mt-1 text-gray-500">{event.outcome || '-'}</div>
                          </td>
                          <td className="px-3 py-2 text-gray-700">
                            <div title={event.requestedCandidateUrl || ''}>{truncateMiddle(event.requestedCandidateUrl)}</div>
                            <div className="mt-1 text-gray-500" title={event.finalUrl || ''}>{truncateMiddle(event.finalUrl)}</div>
                          </td>
                          <td className="px-3 py-2 text-gray-700">
                            <div>{event.targetHostBucket || '-'}</div>
                            <pre className="mt-1 max-w-[340px] overflow-x-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-2 text-[11px] text-gray-600">
                              {prettyJson(event.evidence)}
                            </pre>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
