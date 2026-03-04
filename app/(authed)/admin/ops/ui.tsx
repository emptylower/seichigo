'use client'

import { useEffect, useMemo, useState } from 'react'
import Button from '@/components/shared/Button'
import type {
  AdminOpsInitialData,
  AnitabiDiff,
  AnitabiDiffResponse,
  AnitabiProgress,
  AnitabiProgressResponse,
  AnitabiSyncResponse,
  DetailResponse,
  OpsLogEvent,
  ReportDetail,
  ReportListItem,
  ReportsResponse,
  RunResponse,
} from './types'
import {
  formatAnitabiDiffItem,
  formatDateTime,
  formatPercent,
  formatWindow,
  prettyJson,
  severityColor,
  statusColor,
} from './utils'

const LIST_LIMIT = 20

export type { AdminOpsInitialData, ReportListItem }

export default function AdminOpsUi({ initialData }: { initialData?: AdminOpsInitialData }) {
  const [loading, setLoading] = useState(() => !initialData)
  const [loadingMore, setLoadingMore] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<ReportListItem[]>(() => initialData?.items || [])
  const [nextCursor, setNextCursor] = useState<string | null>(() => initialData?.nextCursor || null)

  const [selectedId, setSelectedId] = useState<string | null>(() => initialData?.selectedId || null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailReport, setDetailReport] = useState<ReportDetail | null>(() => initialData?.detailReport || null)
  const [detailEvents, setDetailEvents] = useState<OpsLogEvent[]>(() => initialData?.detailEvents || [])
  const [anitabiLoading, setAnitabiLoading] = useState(true)
  const [anitabiRunning, setAnitabiRunning] = useState(false)
  const [anitabiError, setAnitabiError] = useState<string | null>(null)
  const [anitabiProgress, setAnitabiProgress] = useState<AnitabiProgress | null>(null)
  const [anitabiDiffLoading, setAnitabiDiffLoading] = useState(false)
  const [anitabiDiff, setAnitabiDiff] = useState<AnitabiDiff | null>(null)
  const [anitabiDiffError, setAnitabiDiffError] = useState<string | null>(null)
  const [anitabiMaxRowsInput, setAnitabiMaxRowsInput] = useState('300')

  const todayDateKey = useMemo(() => new Date().toISOString().slice(0, 10), [])

  const todayReport = useMemo(() => {
    const fromList = items.find((item) => item.dateKey === todayDateKey)
    if (fromList) return fromList
    if (detailReport?.dateKey === todayDateKey) return detailReport
    return null
  }, [items, detailReport, todayDateKey])

  async function loadAnitabiProgress() {
    setAnitabiLoading(true)
    setAnitabiError(null)
    try {
      const res = await fetch('/api/admin/anitabi/progress', { method: 'GET' })
      const data = (await res.json().catch(() => ({}))) as AnitabiProgressResponse
      if (!res.ok || !('ok' in data && data.ok)) {
        throw new Error(('error' in data && data.error) || `Request failed (${res.status})`)
      }
      setAnitabiProgress(data.progress)
    } catch (e) {
      setAnitabiProgress(null)
      setAnitabiError(e instanceof Error ? e.message : '加载 Anitabi 进度失败')
    } finally {
      setAnitabiLoading(false)
    }
  }

  async function loadAnitabiDiff() {
    setAnitabiDiffLoading(true)
    setAnitabiDiffError(null)
    try {
      const res = await fetch('/api/admin/anitabi/diff?sample=8', { method: 'GET' })
      const data = (await res.json().catch(() => ({}))) as AnitabiDiffResponse
      if (!res.ok || !('ok' in data && data.ok)) {
        throw new Error(('error' in data && data.error) || `Request failed (${res.status})`)
      }
      setAnitabiDiff(data.diff)
      return data.diff
    } catch (e) {
      setAnitabiDiff(null)
      setAnitabiDiffError(e instanceof Error ? e.message : '加载 Anitabi 差异失败')
      return null
    } finally {
      setAnitabiDiffLoading(false)
    }
  }

  async function executeAnitabiSync(mode: 'delta' | 'full' | 'dryRun') {
    const parsed = Number.parseInt(anitabiMaxRowsInput.trim(), 10)
    const maxRowsPerRun = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 10000) : undefined

    const res = await fetch('/api/admin/anitabi/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, ...(maxRowsPerRun ? { maxRowsPerRun } : {}) }),
    })

    const data = (await res.json().catch(() => ({}))) as AnitabiSyncResponse
    if (!res.ok || !('runId' in data)) {
      throw new Error(('error' in data && data.error) || `Request failed (${res.status})`)
    }

    if (data.status === 'failed') {
      throw new Error(data.message || '同步失败')
    }
  }

  async function runAnitabiSync(mode: 'delta' | 'full' | 'dryRun') {
    setAnitabiRunning(true)
    setAnitabiError(null)
    try {
      await executeAnitabiSync(mode)
      await Promise.all([loadAnitabiProgress(), loadAnitabiDiff()])
    } catch (e) {
      setAnitabiError(e instanceof Error ? e.message : '执行同步失败')
    } finally {
      setAnitabiRunning(false)
    }
  }

  async function runAnitabiDetectAndSync() {
    setAnitabiRunning(true)
    setAnitabiError(null)
    try {
      const diff = await loadAnitabiDiff()
      if (!diff) return
      if (!diff.needsSync) {
        await loadAnitabiProgress()
        return
      }

      const mode = diff.recommendedMode === 'full' ? 'full' : 'delta'
      await executeAnitabiSync(mode)
      await Promise.all([loadAnitabiProgress(), loadAnitabiDiff()])
    } catch (e) {
      setAnitabiError(e instanceof Error ? e.message : '检测并同步失败')
    } finally {
      setAnitabiRunning(false)
    }
  }

  async function loadReports(options?: { cursor?: string | null; append?: boolean }) {
    const cursor = options?.cursor || null
    const append = Boolean(options?.append)

    if (append) {
      setLoadingMore(true)
    } else {
      setLoading(true)
      setError(null)
    }

    try {
      const params = new URLSearchParams()
      params.set('limit', String(LIST_LIMIT))
      if (cursor) params.set('cursor', cursor)

      const res = await fetch(`/api/admin/ops/reports?${params.toString()}`, { method: 'GET' })
      const data = (await res.json().catch(() => ({}))) as ReportsResponse

      if (!res.ok || !('ok' in data && data.ok)) {
        throw new Error(('error' in data && data.error) || `Request failed (${res.status})`)
      }

      setItems((prev) => (append ? [...prev, ...data.items] : data.items))
      setNextCursor(data.nextCursor || null)

      const hasSelectedInPage = selectedId ? data.items.some((item) => item.id === selectedId) : false
      const reportToLoad = hasSelectedInPage ? selectedId : null

      if (!append && !hasSelectedInPage) {
        setSelectedId(null)
        setDetailReport(null)
        setDetailEvents([])
      }

      if (!append && reportToLoad) {
        await loadDetail(reportToLoad)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载报告失败')
      if (!append) {
        setItems([])
        setNextCursor(null)
      }
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  async function loadDetail(reportId: string) {
    setSelectedId(reportId)
    setDetailLoading(true)
    setDetailError(null)

    try {
      const res = await fetch(`/api/admin/ops/reports/${encodeURIComponent(reportId)}`, {
        method: 'GET',
      })
      const data = (await res.json().catch(() => ({}))) as DetailResponse
      if (!res.ok || !('ok' in data && data.ok)) {
        throw new Error(('error' in data && data.error) || `Request failed (${res.status})`)
      }
      setDetailReport(data.report)
      setDetailEvents(data.events || [])
    } catch (e) {
      setDetailReport(null)
      setDetailEvents([])
      setDetailError(e instanceof Error ? e.message : '加载报告详情失败')
    } finally {
      setDetailLoading(false)
    }
  }

  async function runNow() {
    setRunning(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/ops/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = (await res.json().catch(() => ({}))) as RunResponse
      if (!res.ok || !('ok' in data && data.ok)) {
        throw new Error(('error' in data && data.error) || `Request failed (${res.status})`)
      }

      await loadReports()

      const newId = data.report?.reportId
      if (newId) {
        await loadDetail(newId)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '手动巡检失败')
    } finally {
      setRunning(false)
    }
  }

  async function copyMarkdown() {
    if (!detailReport?.markdownSummary) return
    try {
      await navigator.clipboard.writeText(detailReport.markdownSummary)
    } catch {
      // ignore clipboard failures
    }
  }

  async function copyJson() {
    if (!detailReport) return
    const payload = {
      report: detailReport,
      events: detailEvents,
    }

    try {
      await navigator.clipboard.writeText(prettyJson(payload))
    } catch {
      // ignore clipboard failures
    }
  }

  useEffect(() => {
    if (initialData) return
    void loadReports()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (cancelled) return
      await Promise.all([loadAnitabiProgress(), loadAnitabiDiff()])
    }

    const maybeGlobal = globalThis as typeof globalThis & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
      cancelIdleCallback?: (id: number) => void
    }

    if (typeof maybeGlobal.requestIdleCallback === 'function') {
      const idleId = maybeGlobal.requestIdleCallback(() => {
        void run()
      }, { timeout: 1200 })
      return () => {
        cancelled = true
        maybeGlobal.cancelIdleCallback?.(idleId)
      }
    }

    const timer = setTimeout(() => {
      void run()
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">运维检查</h1>
        <p className="mt-1 text-sm text-gray-600">每日巡检 Vercel 日志并提取异常，可导出 Markdown 与 JSON。</p>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Anitabi 复刻进度</h2>
            <p className="mt-1 text-xs text-gray-500">支持检测源站差异，并与本地点位/作品状态对比后同步。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => void Promise.all([loadAnitabiProgress(), loadAnitabiDiff()])}
              disabled={anitabiLoading || anitabiDiffLoading || anitabiRunning}
            >
              刷新进度
            </Button>
            <Button type="button" variant="ghost" onClick={() => void loadAnitabiDiff()} disabled={anitabiDiffLoading || anitabiRunning}>
              {anitabiDiffLoading ? '检测中…' : '检测差异'}
            </Button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-end gap-2">
          <div className="min-w-[140px]">
            <label className="mb-1 block text-xs text-gray-600">每批最大作品数</label>
            <input
              value={anitabiMaxRowsInput}
              onChange={(e) => setAnitabiMaxRowsInput(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-brand-400"
              inputMode="numeric"
              placeholder="300"
            />
          </div>
          <Button type="button" variant="primary" onClick={() => void runAnitabiDetectAndSync()} disabled={anitabiRunning || anitabiDiffLoading}>
            {anitabiRunning ? '执行中…' : '检测并同步（建议模式）'}
          </Button>
          <Button type="button" variant="primary" onClick={() => void runAnitabiSync('delta')} disabled={anitabiRunning}>
            推进一批（Delta）
          </Button>
          <Button type="button" variant="ghost" onClick={() => void runAnitabiSync('dryRun')} disabled={anitabiRunning}>
            仅扫描（DryRun）
          </Button>
          <Button type="button" variant="ghost" onClick={() => void runAnitabiSync('full')} disabled={anitabiRunning}>
            全量重扫（Full）
          </Button>
        </div>

        {anitabiError ? <div className="mb-4 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{anitabiError}</div> : null}
        {anitabiDiffError ? <div className="mb-4 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{anitabiDiffError}</div> : null}
        {anitabiLoading ? <div className="text-sm text-gray-600">加载进度中…</div> : null}

        {!anitabiLoading && anitabiProgress ? (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="text-xs text-gray-500">当前数据版本</div>
                <div className="mt-1 font-mono text-sm text-gray-900">{anitabiProgress.activeDatasetVersion}</div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="text-xs text-gray-500">作品进度</div>
                <div className="mt-1 text-sm font-semibold text-gray-900">
                  {anitabiProgress.importedBangumi} / {anitabiProgress.sourceBangumiTotal}
                </div>
                <div className="text-xs text-gray-500">待补：{anitabiProgress.pendingBangumi ?? '-'}</div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="text-xs text-gray-500">点位进度（{anitabiProgress.pointTotalMode === 'exact' ? '精确' : anitabiProgress.pointTotalMode === 'estimated' ? '估算' : '未知'}）</div>
                <div className="mt-1 text-sm font-semibold text-gray-900">
                  {anitabiProgress.importedPoints} / {anitabiProgress.pointTotal ?? '-'}
                </div>
                <div className="text-xs text-gray-500">待补：{anitabiProgress.pendingPoints ?? '-'}</div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="text-xs text-gray-500">已导入作品点位覆盖率</div>
                <div className="mt-1 text-sm font-semibold text-gray-900">{formatPercent(anitabiProgress.importedPointCoverageRate)}</div>
                <div className="text-xs text-gray-500">
                  已入库点位 {anitabiProgress.importedPoints} / 期望 {anitabiProgress.expectedPointsInImportedBangumi}
                </div>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-gray-200 p-3">
              <div>
                <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
                  <span>作品完成率</span>
                  <span>{formatPercent(anitabiProgress.worksCompletionRate)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full bg-brand-500"
                    style={{ width: `${Math.max(0, Math.min(100, (anitabiProgress.worksCompletionRate || 0) * 100))}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
                  <span>点位完成率</span>
                  <span>{formatPercent(anitabiProgress.pointsCompletionRate)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full bg-emerald-500"
                    style={{ width: `${Math.max(0, Math.min(100, (anitabiProgress.pointsCompletionRate || 0) * 100))}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 p-3 text-xs text-gray-600">
              <div className="mb-1">最近同步：{anitabiProgress.latestRun ? `${anitabiProgress.latestRun.mode} / ${anitabiProgress.latestRun.status}` : '-'}</div>
              <div className="mb-1">变更数：{anitabiProgress.latestRun?.changedCount ?? '-'}</div>
              <div className="mb-1">开始：{formatDateTime(anitabiProgress.latestRun?.startedAt || null)}</div>
              <div className="mb-1">结束：{formatDateTime(anitabiProgress.latestRun?.endedAt || null)}</div>
              {anitabiProgress.latestRun?.errorSummary ? (
                <div className="rounded bg-rose-50 px-2 py-1 text-rose-700">错误：{anitabiProgress.latestRun.errorSummary}</div>
              ) : null}
              <div className="mt-1 text-gray-500">更新时间：{formatDateTime(anitabiProgress.updatedAt)}</div>
            </div>
          </div>
        ) : null}

        {anitabiDiffLoading ? <div className="mt-4 text-sm text-gray-600">加载差异中…</div> : null}

        {!anitabiDiffLoading && anitabiDiff ? (
          <div className="mt-4 space-y-4 rounded-lg border border-dashed border-gray-300 bg-gray-50/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-gray-900">Anitabi 差异检测</div>
              <div className="text-xs text-gray-500">
                检测时间：{formatDateTime(anitabiDiff.checkedAt)} · 建议：{anitabiDiff.recommendedMode === 'full' ? 'Full' : 'Delta'}
              </div>
            </div>
            <div className="text-xs text-gray-500">
              当前版本 {anitabiDiff.activeDatasetVersion} · 源站作品 {anitabiDiff.sourceTotal} · 本地作品 {anitabiDiff.localTotal}
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="text-xs text-gray-500">作品差异</div>
                <div className="mt-1 text-sm text-gray-900">
                  源站新增 {anitabiDiff.works.sourceOnlyCount} / 本地孤儿 {anitabiDiff.works.localOnlyCount}
                </div>
                <div className="text-xs text-gray-500">源站更新 {anitabiDiff.works.modifiedCount} / 点位缺口 {anitabiDiff.works.pointGapCount}</div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="text-xs text-gray-500">待同步作品数</div>
                <div className="mt-1 text-sm font-semibold text-gray-900">{anitabiDiff.works.syncCandidateCount}</div>
                <div className="text-xs text-gray-500">{anitabiDiff.needsSync ? '检测到需同步差异' : '当前无需同步'}</div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="text-xs text-gray-500">点位缺口</div>
                <div className="mt-1 text-sm font-semibold text-gray-900">{anitabiDiff.points.missingInLocalWorks}</div>
                <div className="text-xs text-gray-500">
                  已入库 {anitabiDiff.points.importedInLocalWorks} / 期望 {anitabiDiff.points.expectedInLocalWorks}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="text-xs text-gray-500">作品状态</div>
                <div className="mt-1 text-sm text-gray-900">
                  在地图中 {anitabiDiff.status.mapEnabledWorks} / 已映射 {anitabiDiff.status.mappedWorks}
                </div>
                <div className="text-xs text-gray-500">
                  未映射 {anitabiDiff.status.unmappedWorks} / 映射到隐藏作品 {anitabiDiff.status.hiddenAnimeLinkedWorks}
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="mb-2 text-xs font-semibold text-gray-700">源站新增（示例）</div>
                {anitabiDiff.examples.sourceOnly.length ? (
                  <ul className="space-y-1 text-xs text-gray-600">
                    {anitabiDiff.examples.sourceOnly.map((item) => (
                      <li key={`sourceOnly-${item.id}`}>{formatAnitabiDiffItem(item)}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs text-gray-500">无</div>
                )}
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="mb-2 text-xs font-semibold text-gray-700">源站更新（示例）</div>
                {anitabiDiff.examples.modified.length ? (
                  <ul className="space-y-1 text-xs text-gray-600">
                    {anitabiDiff.examples.modified.map((item) => (
                      <li key={`modified-${item.id}`}>{formatAnitabiDiffItem(item)}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs text-gray-500">无</div>
                )}
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="mb-2 text-xs font-semibold text-gray-700">点位缺口（示例）</div>
                {anitabiDiff.examples.pointGap.length ? (
                  <ul className="space-y-1 text-xs text-gray-600">
                    {anitabiDiff.examples.pointGap.map((item) => (
                      <li key={`pointGap-${item.id}`}>{formatAnitabiDiffItem(item)}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs text-gray-500">无</div>
                )}
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="mb-2 text-xs font-semibold text-gray-700">本地孤儿数据（示例）</div>
                {anitabiDiff.examples.localOnly.length ? (
                  <ul className="space-y-1 text-xs text-gray-600">
                    {anitabiDiff.examples.localOnly.map((item) => (
                      <li key={`localOnly-${item.id}`}>{formatAnitabiDiffItem(item)}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-xs text-gray-500">无</div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="primary" onClick={runNow} disabled={running || loading}>
            {running ? '巡检中…' : '立即巡检'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => void loadReports()} disabled={loading || running}>
            刷新列表
          </Button>
          <Button type="button" variant="ghost" onClick={copyMarkdown} disabled={!detailReport}>
            复制 Markdown
          </Button>
          <Button type="button" variant="ghost" onClick={copyJson} disabled={!detailReport}>
            复制 JSON
          </Button>
        </div>

        {error ? <div className="mt-4 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-gray-500">今日日期（UTC）</div>
          <div className="mt-1 text-lg font-semibold text-gray-900">{todayDateKey}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-gray-500">严重异常</div>
          <div className="mt-1 text-lg font-semibold text-rose-700">{todayReport?.severeCount ?? 0}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-gray-500">警告异常</div>
          <div className="mt-1 text-lg font-semibold text-amber-700">{todayReport?.warningCount ?? 0}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-gray-500">日志扫描量 / 状态</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-lg font-semibold text-gray-900">{todayReport?.totalLogs ?? 0}</span>
            <span className={`rounded border px-2 py-0.5 text-xs ${statusColor(todayReport?.status || '-')}`}>
              {todayReport?.status || '-'}
            </span>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">历史报告</h2>
          <span className="text-sm text-gray-500">共 {items.length} 条（分页）</span>
        </div>

        {loading ? <div className="text-sm text-gray-600">加载中…</div> : null}

        {!loading ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-3">日期</th>
                  <th className="py-2 pr-3">触发方式</th>
                  <th className="py-2 pr-3">状态</th>
                  <th className="py-2 pr-3">严重</th>
                  <th className="py-2 pr-3">警告</th>
                  <th className="py-2 pr-3">日志</th>
                  <th className="py-2 pr-3">创建时间</th>
                  <th className="py-2 pr-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className={`border-b last:border-0 ${selectedId === item.id ? 'bg-gray-50' : ''}`}
                  >
                    <td className="py-3 pr-3 font-mono text-xs">{item.dateKey}</td>
                    <td className="py-3 pr-3">{item.triggerMode}</td>
                    <td className="py-3 pr-3">
                      <span className={`rounded border px-2 py-0.5 text-xs ${statusColor(item.status)}`}>{item.status}</span>
                    </td>
                    <td className="py-3 pr-3 text-rose-700 font-medium">{item.severeCount}</td>
                    <td className="py-3 pr-3 text-amber-700 font-medium">{item.warningCount}</td>
                    <td className="py-3 pr-3">{item.totalLogs}</td>
                    <td className="py-3 pr-3">{formatDateTime(item.createdAt)}</td>
                    <td className="py-3 pr-3">
                      <button
                        type="button"
                        onClick={() => void loadDetail(item.id)}
                        className="rounded border border-gray-200 px-2 py-1 text-xs hover:bg-gray-50"
                      >
                        查看
                      </button>
                    </td>
                  </tr>
                ))}
                {!items.length ? (
                  <tr>
                    <td className="py-4 text-gray-500" colSpan={8}>
                      暂无报告
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}

        {nextCursor ? (
          <div className="mt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => void loadReports({ cursor: nextCursor, append: true })}
              disabled={loadingMore}
            >
              {loadingMore ? '加载中…' : '加载更多'}
            </Button>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">报告详情</h2>
          {detailReport ? (
            <div className="text-xs text-gray-500">窗口：{formatWindow(detailReport.windowStart, detailReport.windowEnd)}</div>
          ) : null}
        </div>

        {detailLoading ? <div className="text-sm text-gray-600">加载详情中…</div> : null}
        {detailError ? <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{detailError}</div> : null}

        {!detailLoading && !detailError && detailReport ? (
          <div className="space-y-5">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="mb-2 text-sm font-medium text-gray-700">Markdown 摘要</div>
              <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-gray-800">
                {detailReport.markdownSummary}
              </pre>
            </div>

            <div className="rounded-lg border border-gray-200">
              <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
                <div className="text-sm font-medium text-gray-700">异常明细</div>
                <div className="text-xs text-gray-500">共 {detailEvents.length} 条</div>
              </div>
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b text-left text-gray-500">
                      <th className="px-3 py-2">级别</th>
                      <th className="px-3 py-2">时间</th>
                      <th className="px-3 py-2">状态码</th>
                      <th className="px-3 py-2">请求</th>
                      <th className="px-3 py-2">指纹</th>
                      <th className="px-3 py-2">消息</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailEvents.map((event) => (
                      <tr key={event.id} className="border-b last:border-0">
                        <td className="px-3 py-2 align-top">
                          <span className={`rounded border px-2 py-0.5 ${severityColor(event.severity)}`}>
                            {event.severity}
                          </span>
                        </td>
                        <td className="px-3 py-2 align-top">{formatDateTime(event.timestamp || event.createdAt)}</td>
                        <td className="px-3 py-2 align-top">{event.statusCode ?? '-'}</td>
                        <td className="px-3 py-2 align-top">
                          <div className="font-mono">{event.method || '-'} {event.path || '-'}</div>
                          <div className="text-[10px] text-gray-500">deployment: {event.deploymentId || '-'}</div>
                        </td>
                        <td className="px-3 py-2 align-top font-mono">{event.fingerprint}</td>
                        <td className="px-3 py-2 align-top whitespace-pre-wrap">{event.message}</td>
                      </tr>
                    ))}
                    {!detailEvents.length ? (
                      <tr>
                        <td className="px-3 py-3 text-gray-500" colSpan={6}>
                          该报告没有异常事件。
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="mb-2 text-sm font-medium text-gray-700">原始聚合信息（JSON）</div>
              <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-gray-800">
                {prettyJson(detailReport.rawSummary || {})}
              </pre>
            </div>
          </div>
        ) : null}

        {!detailLoading && !detailError && !detailReport ? (
          <div className="text-sm text-gray-500">请选择一条报告查看详情。</div>
        ) : null}
      </section>
    </div>
  )
}
