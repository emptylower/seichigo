'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type RunMode = 'preview' | 'generate'
type Locale = 'zh' | 'en' | 'ja'

type RunDefaults = {
  mode: RunMode
  locales: Locale[]
  scope: 'all'
  maxTopics: number
}

type RunListItem = {
  runId: number
  status: string
  conclusion: string | null
  mode: RunMode | null
  htmlUrl: string
  prUrl: string | null
  createdAt: string
  updatedAt: string
  actor: string | null
  headBranch: string | null
}

type RunDetail = {
  runId: number
  status: string
  conclusion: string | null
  mode: RunMode | null
  htmlUrl: string
  createdAt: string
  updatedAt: string
  prUrl: string | null
  summary: Record<string, unknown> | null
  artifacts: Array<{ id: number; name: string; sizeInBytes: number; expired: boolean }>
}

type RunResponse = {
  runId: number
  runUrl: string
  mode: RunMode
  queuedAt: string
}

type RunsResponse = {
  runs: RunListItem[]
}

type Props = {
  generateEnabled: boolean
  defaults: RunDefaults
}

const LOCALE_OPTIONS: Array<{ id: Locale; label: string }> = [
  { id: 'zh', label: '中文 (zh)' },
  { id: 'en', label: 'English (en)' },
  { id: 'ja', label: '日本語 (ja)' },
]

function formatDateTime(value: string): string {
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return value
  return new Date(ms).toLocaleString('zh-CN')
}

function getSummaryNumber(summary: Record<string, unknown> | null, key: string): number | null {
  if (!summary) return null
  const raw = summary[key]
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function getSummaryText(summary: Record<string, unknown> | null, key: string): string | null {
  if (!summary) return null
  const raw = summary[key]
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  return text || null
}

export default function SpokeFactoryUi({ generateEnabled, defaults }: Props) {
  const [mode, setMode] = useState<RunMode>(defaults.mode)
  const [locales, setLocales] = useState<Locale[]>(defaults.locales)
  const [maxTopics, setMaxTopics] = useState<number>(defaults.maxTopics)
  const [scope] = useState<'all'>(defaults.scope)

  const [running, setRunning] = useState(false)
  const [runMessage, setRunMessage] = useState<string | null>(null)
  const [runs, setRuns] = useState<RunListItem[]>([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [runsError, setRunsError] = useState<string | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const canRunGenerate = generateEnabled
  const canSubmit = !running && locales.length > 0 && maxTopics > 0 && (mode !== 'generate' || canRunGenerate)

  const loadRuns = useCallback(async () => {
    setRunsLoading(true)
    setRunsError(null)
    try {
      const res = await fetch('/api/admin/seo/spoke-factory/runs?limit=20', { method: 'GET' })
      const data = (await res.json().catch(() => ({}))) as RunsResponse & { error?: string }
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`)
      }
      setRuns(Array.isArray(data.runs) ? data.runs : [])
    } catch (err) {
      setRunsError(err instanceof Error ? err.message : '加载运行记录失败')
      setRuns([])
    } finally {
      setRunsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRuns()
  }, [loadRuns])

  async function loadRunDetail(runId: number) {
    setSelectedRunId(runId)
    setDetailLoading(true)
    setDetailError(null)
    try {
      const res = await fetch(`/api/admin/seo/spoke-factory/runs/${runId}`, { method: 'GET' })
      const data = (await res.json().catch(() => ({}))) as RunDetail & { error?: string }
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`)
      }
      setSelectedRun(data)
    } catch (err) {
      setSelectedRun(null)
      setDetailError(err instanceof Error ? err.message : '加载运行详情失败')
    } finally {
      setDetailLoading(false)
    }
  }

  async function handleRun() {
    if (!canSubmit) return

    setRunning(true)
    setRunMessage(null)
    try {
      const payload = {
        mode,
        locales,
        scope,
        maxTopics,
      }
      const res = await fetch('/api/admin/seo/spoke-factory/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await res.json().catch(() => ({}))) as RunResponse & { error?: string }
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`)
      }
      setRunMessage(`已触发 ${data.mode} 任务：#${data.runId}`)
      await loadRuns()
    } catch (err) {
      setRunMessage(err instanceof Error ? err.message : '触发任务失败')
    } finally {
      setRunning(false)
    }
  }

  const localeSet = useMemo(() => new Set(locales), [locales])

  function toggleLocale(locale: Locale, checked: boolean) {
    if (checked) {
      setLocales((prev) => (prev.includes(locale) ? prev : [...prev, locale]))
      return
    }
    setLocales((prev) => prev.filter((item) => item !== locale))
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">长尾页面工厂</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          手动触发 SEO spoke 自动化：候选提取、AI 生成、创建 PR、部署后自动进入 sitemap。
        </p>
      </div>

      {!generateEnabled ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          生产环境当前仅开放 Preview。若要启用 Generate，请配置
          <span className="mx-1 font-mono">SEO_AUTOMATION_ENABLE_GENERATE=1</span>。
        </div>
      ) : null}

      <section className="space-y-4 rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">执行参数</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <div className="text-sm font-medium">执行模式</div>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as RunMode)}
              className="h-10 w-full rounded-md border px-3 text-sm"
            >
              <option value="preview">preview（仅预览）</option>
              <option value="generate" disabled={!canRunGenerate}>
                generate（写文件 + PR）
              </option>
            </select>
          </label>

          <label className="space-y-2">
            <div className="text-sm font-medium">每次主题上限</div>
            <input
              type="number"
              min={1}
              max={30}
              value={maxTopics}
              onChange={(e) => {
                const parsed = Number.parseInt(e.target.value || '30', 10)
                const safe = Number.isFinite(parsed) ? Math.max(1, Math.min(30, parsed)) : 30
                setMaxTopics(safe)
              }}
              className="h-10 w-full rounded-md border px-3 text-sm"
            />
          </label>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">目标语言</div>
          <div className="flex flex-wrap gap-4 text-sm">
            {LOCALE_OPTIONS.map((item) => (
              <label key={item.id} className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={localeSet.has(item.id)}
                  onChange={(e) => toggleLocale(item.id, e.target.checked)}
                />
                {item.label}
              </label>
            ))}
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          来源范围固定为全部作品（scope=all），仅从已发布且非 <span className="font-mono">seo-spoke</span> 的内容提取候选。
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleRun}
            disabled={!canSubmit}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? '触发中...' : mode === 'preview' ? '运行 Preview' : '运行 Generate'}
          </button>

          <button
            type="button"
            onClick={() => {
              void loadRuns()
            }}
            className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-gray-50"
          >
            刷新记录
          </button>
        </div>

        {runMessage ? <div className="text-sm text-muted-foreground">{runMessage}</div> : null}
      </section>

      <section className="space-y-4 rounded-xl border bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">最近运行</h2>
          <span className="text-sm text-muted-foreground">{runs.length} 条</span>
        </div>

        {runsLoading ? <div className="text-sm text-muted-foreground">加载中...</div> : null}
        {runsError ? <div className="text-sm text-rose-600">{runsError}</div> : null}

        {!runsLoading && !runsError ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3">Run</th>
                  <th className="py-2 pr-3">模式</th>
                  <th className="py-2 pr-3">状态</th>
                  <th className="py-2 pr-3">结论</th>
                  <th className="py-2 pr-3">PR</th>
                  <th className="py-2 pr-3">创建时间</th>
                  <th className="py-2 pr-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.runId} className="border-b last:border-0">
                    <td className="py-3 pr-3 font-mono text-xs">#{run.runId}</td>
                    <td className="py-3 pr-3">{run.mode || '-'}</td>
                    <td className="py-3 pr-3">{run.status}</td>
                    <td className="py-3 pr-3">{run.conclusion || '-'}</td>
                    <td className="py-3 pr-3">
                      {run.prUrl ? (
                        <a href={run.prUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800">
                          PR
                        </a>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="py-3 pr-3">{formatDateTime(run.createdAt)}</td>
                    <td className="py-3 pr-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <a
                          href={run.htmlUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:text-blue-800"
                        >
                          查看 Run
                        </a>
                        <button
                          type="button"
                          onClick={() => {
                            void loadRunDetail(run.runId)
                          }}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          详情
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!runs.length ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-muted-foreground">
                      暂无运行记录
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {selectedRunId ? (
        <section className="space-y-3 rounded-xl border bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">运行详情 #{selectedRunId}</h2>
            <button
              type="button"
              onClick={() => {
                setSelectedRunId(null)
                setSelectedRun(null)
                setDetailError(null)
              }}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              关闭
            </button>
          </div>

          {detailLoading ? <div className="text-sm text-muted-foreground">加载详情中...</div> : null}
          {detailError ? <div className="text-sm text-rose-600">{detailError}</div> : null}

          {!detailLoading && selectedRun ? (
            <div className="space-y-2 text-sm">
              <div>状态：{selectedRun.status}</div>
              <div>结论：{selectedRun.conclusion || '-'}</div>
              <div>
                Run：
                <a href={selectedRun.htmlUrl} target="_blank" rel="noreferrer" className="ml-1 text-blue-600 hover:text-blue-800">
                  {selectedRun.htmlUrl}
                </a>
              </div>
              <div>
                PR：{' '}
                {selectedRun.prUrl ? (
                  <a href={selectedRun.prUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800">
                    {selectedRun.prUrl}
                  </a>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </div>
              <div>Artifact 数量：{selectedRun.artifacts.length}</div>
              <div>
                数据来源：{getSummaryText(selectedRun.summary, 'sourceOrigin') ?? '-'}，来源文章数：
                {getSummaryNumber(selectedRun.summary, 'sourcePostCount') ?? '-'}，候选主题数：
                {getSummaryNumber(selectedRun.summary, 'candidateCount') ?? '-'}，入选主题数：
                {getSummaryNumber(selectedRun.summary, 'selectedTopics') ?? '-'}
              </div>
              {getSummaryNumber(selectedRun.summary, 'sourcePostCount') === 0 ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  当前来源文章数为 0。工厂会排除 <span className="font-mono">seo-spoke</span> 页面；若你的原文主要在数据库，
                  请在 GitHub Actions Secrets 配置 <span className="font-mono">SEO_AUTOMATION_DATABASE_URL</span>（或
                  <span className="font-mono"> DATABASE_URL</span>）。若不能直连数据库，也可配置
                  <span className="font-mono"> SEO_AUTOMATION_AI_API_BASE_URL</span> +
                  <span className="font-mono"> SEO_AUTOMATION_AI_API_KEY</span> 通过 AI API 拉取已发布文章。
                </div>
              ) : null}
              <pre className="max-h-[360px] overflow-auto rounded-md border bg-gray-50 p-3 text-xs">
                {JSON.stringify(selectedRun.summary || { message: 'summary 不可用' }, null, 2)}
              </pre>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
