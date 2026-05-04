'use client'

import { useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/Button'
import { formatDateTime, formatPercent, truncateMiddle } from './utils'

const POLL_INTERVAL_MS = 30_000

type MirrorBootstrap = {
  bangumiCursor: number | null
  pointCursor: string | null
  bangumiCompleted: boolean
  pointCompleted: boolean
  totalEnumerated: number | null
  startedAt: string | null
  completedAt: string | null
  lastAdvanceAt: string | null
  manuallyTriggered: boolean
}

type MirrorStatusResponse = {
  totals: {
    all: number
    pending: number
    in_progress: number
    mirrored: number
    failed: number
    skipped_404: number
  }
  bootstrap: MirrorBootstrap | null
  recentFailures: Array<{
    canonicalUrl: string
    lastError: string | null
    attempts: number
    lastAttemptAt: string | null
  }>
  rates: {
    remaining: number
    mirroredLast1h: number
    mirroredLast24h: number
    ratePerSec: number
    estimatedRemainingHours: number | null
  }
}

type BootstrapMode = 'advance' | 'force-complete'

function formatRatePerMinute(ratePerSec: number): string {
  if (!Number.isFinite(ratePerSec) || ratePerSec <= 0) return '暂无吞吐'
  const perMinute = ratePerSec * 60
  return `${perMinute >= 10 ? Math.round(perMinute) : perMinute.toFixed(1)} 张/分钟`
}

function formatEta(hours: number | null): string {
  if (hours == null || !Number.isFinite(hours)) return '暂无法估算'
  if (hours <= 1 / 60) return '预计不足 1 分钟'
  if (hours < 1) return `预计约 ${Math.max(1, Math.round(hours * 60))} 分钟`
  return `预计约 ${hours >= 10 ? Math.round(hours) : hours.toFixed(1)} 小时`
}

function formatBootstrapValue(value: number | string | null | undefined): string {
  if (value == null || value === '') return '-'
  return String(value)
}

function formatServerError(data: unknown, status: number): string {
  const message = typeof data === 'object' && data && 'error' in data ? (data as { error?: unknown }).error : null
  return typeof message === 'string' && message.trim() ? message : `请求失败（${status}）`
}

export default function MirrorProgressPanel() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<MirrorStatusResponse | null>(null)
  const [savingMode, setSavingMode] = useState<BootstrapMode | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionNote, setActionNote] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  async function loadStatus(options?: { silent?: boolean }) {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    if (!options?.silent) {
      setLoading(true)
    }

    try {
      const res = await fetch('/api/admin/anitabi/image-mirror/status', {
        method: 'GET',
        credentials: 'include',
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(formatServerError(data, res.status))
      }

      if (requestIdRef.current !== requestId) return
      setStatus(data as MirrorStatusResponse)
      setError(null)
    } catch (err) {
      if (requestIdRef.current !== requestId) return
      setError(err instanceof Error ? err.message : '加载镜像进度失败')
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false)
      }
    }
  }

  async function triggerBootstrap(mode: BootstrapMode) {
    setSavingMode(mode)
    setActionError(null)
    setActionNote(null)

    try {
      const res = await fetch('/api/admin/anitabi/image-mirror/bootstrap', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(formatServerError(data, res.status))
      }

      const elapsedMs = typeof data === 'object' && data && 'elapsedMs' in data ? (data as { elapsedMs?: unknown }).elapsedMs : null
      const stillNeedsManualPush = typeof data === 'object' && data && 'stillNeedsManualPush' in data
        ? Boolean((data as { stillNeedsManualPush?: unknown }).stillNeedsManualPush)
        : false

      const actionLabel = mode === 'advance' ? '推进一次' : '强制补齐'
      const tail = stillNeedsManualPush ? '，仍需继续推进。' : '，当前引导已完成。'
      const elapsedText = typeof elapsedMs === 'number' ? `（耗时 ${Math.round(elapsedMs)}ms）` : ''
      setActionNote(`${actionLabel}已触发${elapsedText}${tail}`)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '执行镜像引导失败')
    } finally {
      setSavingMode(null)
      await loadStatus({ silent: true })
    }
  }

  useEffect(() => {
    void loadStatus()
    const timer = window.setInterval(() => {
      void loadStatus({ silent: true })
    }, POLL_INTERVAL_MS)

    return () => {
      window.clearInterval(timer)
      requestIdRef.current += 1
    }
  }, [])

  const totals = status?.totals
  const bootstrap = status?.bootstrap
  const rates = status?.rates
  const mirroredPercent = totals ? formatPercent(totals.mirrored, totals.all) : '0%'
  const progressWidth = totals?.all ? Math.max(4, Math.round((totals.mirrored / totals.all) * 100)) : 0

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">镜像迁移进度</h2>
          <p className="mt-1 text-sm text-gray-600">轮询镜像迁移总体进度，并允许管理员手动推进 bootstrap 游标。</p>
          <p className="mt-2 text-xs text-gray-500">面板会在进入页面后立即拉取，并每 30 秒自动刷新一次。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => void triggerBootstrap('advance')}
            disabled={loading || savingMode !== null}
          >
            {savingMode === 'advance' ? '推进中…' : '推进一次'}
          </Button>
          <Button
            type="button"
            onClick={() => void triggerBootstrap('force-complete')}
            disabled={loading || savingMode !== null}
          >
            {savingMode === 'force-complete' ? '补齐中…' : '强制补齐'}
          </Button>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {loading && !status ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-600">
            正在加载镜像迁移状态…
          </div>
        ) : null}

        {error && !status ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            加载失败：{error}
          </div>
        ) : null}

        {status ? (
          <>
            {error ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                最近一次刷新失败：{error}
              </div>
            ) : null}
            {actionError ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                操作失败：{actionError}
              </div>
            ) : null}
            {actionNote ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {actionNote}
              </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
              <div className="space-y-4 rounded-lg border border-gray-200 p-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-gray-900">镜像覆盖率</div>
                    <div className="mt-1 text-3xl font-semibold text-gray-900">{mirroredPercent}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      已镜像 {totals?.mirrored ?? 0} / 总量 {totals?.all ?? 0}
                    </div>
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    <div>剩余待处理：{rates?.remaining ?? 0}</div>
                    <div className="mt-1">{formatRatePerMinute(rates?.ratePerSec ?? 0)}</div>
                    <div className="mt-1">{formatEta(rates?.estimatedRemainingHours ?? null)}</div>
                  </div>
                </div>

                <div>
                  <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-brand-500 transition-[width]"
                      style={{ width: `${progressWidth}%` }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500">
                    <span>最近 1 小时新增：{rates?.mirroredLast1h ?? 0}</span>
                    <span>最近 24 小时新增：{rates?.mirroredLast24h ?? 0}</span>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  {[
                    { label: '待处理', value: totals?.pending ?? 0 },
                    { label: '处理中', value: totals?.in_progress ?? 0 },
                    { label: '已镜像', value: totals?.mirrored ?? 0 },
                    { label: '失败', value: totals?.failed ?? 0 },
                    { label: '404 跳过', value: totals?.skipped_404 ?? 0 },
                  ].map((item) => (
                    <div key={item.label} className="rounded-md border border-gray-200 bg-gray-50 px-3 py-3">
                      <div className="text-xs text-gray-500">{item.label}</div>
                      <div className="mt-1 text-xl font-semibold text-gray-900">{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4 rounded-lg border border-gray-200 p-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-medium text-gray-900">Bootstrap 游标</h3>
                    {bootstrap ? (
                      <>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${bootstrap.bangumiCompleted ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
                          Bangumi {bootstrap.bangumiCompleted ? '已完成' : '未完成'}
                        </span>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${bootstrap.pointCompleted ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
                          Point {bootstrap.pointCompleted ? '已完成' : '未完成'}
                        </span>
                      </>
                    ) : (
                      <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600">
                        尚未初始化
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    用于确认枚举推进是否卡住，以及是否已完成首次全量导入。
                    {!bootstrap ? ' 如果这里还是空白，先执行一次“推进一次”。' : ''}
                  </p>
                </div>

                <dl className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md border border-gray-200 px-3 py-3">
                    <dt className="text-xs text-gray-500">Bangumi 游标</dt>
                    <dd className="mt-1 font-mono text-sm text-gray-900">{formatBootstrapValue(bootstrap?.bangumiCursor)}</dd>
                  </div>
                  <div className="rounded-md border border-gray-200 px-3 py-3">
                    <dt className="text-xs text-gray-500">Point 游标</dt>
                    <dd className="mt-1 font-mono text-sm text-gray-900">{formatBootstrapValue(bootstrap?.pointCursor)}</dd>
                  </div>
                  <div className="rounded-md border border-gray-200 px-3 py-3">
                    <dt className="text-xs text-gray-500">已枚举总量</dt>
                    <dd className="mt-1 text-sm font-semibold text-gray-900">{formatBootstrapValue(bootstrap?.totalEnumerated)}</dd>
                  </div>
                  <div className="rounded-md border border-gray-200 px-3 py-3">
                    <dt className="text-xs text-gray-500">手动触发</dt>
                    <dd className="mt-1 text-sm text-gray-900">{bootstrap ? (bootstrap.manuallyTriggered ? '是' : '否') : '-'}</dd>
                  </div>
                  <div className="rounded-md border border-gray-200 px-3 py-3">
                    <dt className="text-xs text-gray-500">开始时间</dt>
                    <dd className="mt-1 text-sm text-gray-900">{formatDateTime(bootstrap?.startedAt)}</dd>
                  </div>
                  <div className="rounded-md border border-gray-200 px-3 py-3">
                    <dt className="text-xs text-gray-500">最近推进</dt>
                    <dd className="mt-1 text-sm text-gray-900">{formatDateTime(bootstrap?.lastAdvanceAt)}</dd>
                  </div>
                  <div className="rounded-md border border-gray-200 px-3 py-3 sm:col-span-2">
                    <dt className="text-xs text-gray-500">完成时间</dt>
                    <dd className="mt-1 text-sm text-gray-900">{formatDateTime(bootstrap?.completedAt)}</dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-gray-900">最近失败样本</h3>
                  <p className="mt-1 text-xs text-gray-500">保留最近 10 条失败记录，用于判断源站错误还是单点脏数据。</p>
                </div>
                <div className="text-xs text-gray-500">按最近尝试时间倒序</div>
              </div>
              <div className="mt-3 space-y-2">
                {status.recentFailures.length === 0 ? (
                  <div className="rounded-md border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500">
                    暂无失败记录。
                  </div>
                ) : status.recentFailures.map((failure) => (
                  <div key={`${failure.canonicalUrl}-${failure.lastAttemptAt || 'none'}`} className="rounded-md border border-gray-200 px-3 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-gray-900">{truncateMiddle(failure.canonicalUrl, 38, 26)}</div>
                        <div className="mt-1 text-xs text-gray-500">{failure.lastError || '未返回错误文本'}</div>
                      </div>
                      <div className="shrink-0 text-right text-[11px] text-gray-500">
                        <div>尝试 {failure.attempts} 次</div>
                        <div className="mt-1">{formatDateTime(failure.lastAttemptAt)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </section>
  )
}
