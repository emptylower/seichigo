'use client'

import { useEffect, useMemo, useState } from 'react'
import Button from '@/components/shared/Button'

type ReportListItem = {
  id: string
  source: string
  dateKey: string
  triggerMode: string
  status: string
  totalDeployments: number
  totalLogs: number
  severeCount: number
  warningCount: number
  truncated: boolean
  windowStart: string
  windowEnd: string
  createdAt: string
}

type ReportDetail = ReportListItem & {
  markdownSummary: string
  rawSummary: Record<string, unknown> | null
}

type OpsLogEvent = {
  id: string
  severity: 'severe' | 'warning' | string
  fingerprint: string
  timestamp: string | null
  deploymentId: string | null
  requestId: string | null
  path: string | null
  method: string | null
  statusCode: number | null
  message: string
  raw: Record<string, unknown> | null
  createdAt: string
}

type ReportsResponse =
  | {
      ok: true
      items: ReportListItem[]
      nextCursor: string | null
    }
  | {
      error: string
    }

type RunResponse =
  | {
      ok: true
      report: {
        reportId: string
      }
    }
  | {
      error: string
    }

type DetailResponse =
  | {
      ok: true
      report: ReportDetail
      events: OpsLogEvent[]
    }
  | {
      error: string
    }

const LIST_LIMIT = 20

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-'
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return value
  return new Date(ms).toLocaleString('zh-CN')
}

function formatWindow(start: string, end: string): string {
  return `${formatDateTime(start)} → ${formatDateTime(end)}`
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function statusColor(status: string): string {
  if (status === 'ok') return 'text-emerald-700 bg-emerald-50 border-emerald-200'
  if (status === 'partial') return 'text-amber-700 bg-amber-50 border-amber-200'
  if (status === 'failed') return 'text-rose-700 bg-rose-50 border-rose-200'
  return 'text-gray-700 bg-gray-50 border-gray-200'
}

function severityColor(severity: string): string {
  if (severity === 'severe') return 'text-rose-700 bg-rose-50 border-rose-200'
  return 'text-amber-700 bg-amber-50 border-amber-200'
}

export default function AdminOpsUi() {
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<ReportListItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailReport, setDetailReport] = useState<ReportDetail | null>(null)
  const [detailEvents, setDetailEvents] = useState<OpsLogEvent[]>([])

  const todayDateKey = useMemo(() => new Date().toISOString().slice(0, 10), [])

  const todayReport = useMemo(() => {
    const fromList = items.find((item) => item.dateKey === todayDateKey)
    if (fromList) return fromList
    if (detailReport?.dateKey === todayDateKey) return detailReport
    return null
  }, [items, detailReport, todayDateKey])

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

      const reportToLoad =
        selectedId && data.items.some((item) => item.id === selectedId)
          ? selectedId
          : data.items[0]?.id || (append ? selectedId : null)

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
    void loadReports()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">运维检查</h1>
        <p className="mt-1 text-sm text-gray-600">每日巡检 Vercel 日志并提取异常，可导出 Markdown 与 JSON。</p>
      </div>

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
