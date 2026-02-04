'use client'

import { useState } from 'react'
import { TrendingUp, Database, Zap, RefreshCw, Search } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Keyword = {
  id: string
  keyword: string
  language: string
  category: string
  priority: number
  isActive: boolean
  rankHistory: Array<{
    position: number | null
    checkedAt: Date
  }>
}

type TopQuery = {
  query: string
  _sum: {
    clicks: number | null
    impressions: number | null
  }
}

type SerpUsage = {
  count: number
} | null

type Props = {
  keywords: Keyword[]
  topQueries: TopQuery[]
  serpUsage: SerpUsage
}

type KeywordDraft = {
  keyword: string
  language: 'zh' | 'en' | 'ja'
  category: 'short-tail' | 'long-tail'
  priority: number
  isActive: boolean
}

const emptyDraft: KeywordDraft = {
  keyword: '',
  language: 'zh',
  category: 'long-tail',
  priority: 0,
  isActive: true,
}

export default function SeoUi({ keywords, topQueries, serpUsage }: Props) {
  const [syncing, setSyncing] = useState(false)
  const [checking, setChecking] = useState<string | null>(null)
  const [syncDays, setSyncDays] = useState(7)
  const [showInactive, setShowInactive] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createDraft, setCreateDraft] = useState<KeywordDraft>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<KeywordDraft>(emptyDraft)

  async function requestJson<T>(url: string, opts: { method: string; body?: unknown }): Promise<T> {
    const res = await fetch(url, {
      method: opts.method,
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
    const data = (await res.json().catch(() => ({}))) as any
    if (!res.ok) {
      const message =
        typeof data?.error === 'string' && data.error.trim()
          ? data.error
          : `Request failed (${res.status})`
      throw new Error(message)
    }
    return data as T
  }

  async function handleSync() {
    setSyncing(true)
    try {
      const days = Number.isFinite(syncDays) && syncDays > 0 ? syncDays : 7
      const data = await requestJson<{ message?: string }>(`/api/admin/seo/sync?days=${days}`, {
        method: 'POST',
      })
      alert(data.message || 'Sync complete')
      window.location.reload()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  async function handleRankCheck(keywordId: string) {
    setChecking(keywordId)
    try {
      const data = await requestJson<{ message?: string }>('/api/admin/seo/rank', {
        method: 'POST',
        body: { keywordId },
      })
      alert(data.message || 'Check complete')
      window.location.reload()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Check failed')
    } finally {
      setChecking(null)
    }
  }

  async function handleCreateKeyword() {
    const keyword = createDraft.keyword.trim()
    if (!keyword) {
      alert('请输入关键词')
      return
    }

    try {
      await requestJson('/api/admin/seo/keywords', {
        method: 'POST',
        body: { ...createDraft, keyword },
      })
      window.location.reload()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Create failed')
    }
  }

  function startEditKeyword(kw: Keyword) {
    setEditingId(kw.id)
    setEditDraft({
      keyword: kw.keyword,
      language: kw.language as KeywordDraft['language'],
      category: kw.category as KeywordDraft['category'],
      priority: kw.priority,
      isActive: kw.isActive,
    })
  }

  function cancelEditKeyword() {
    setEditingId(null)
    setEditDraft(emptyDraft)
  }

  async function handleUpdateKeyword() {
    if (!editingId) return
    const keyword = editDraft.keyword.trim()
    if (!keyword) {
      alert('请输入关键词')
      return
    }

    try {
      await requestJson(`/api/admin/seo/keywords/${encodeURIComponent(editingId)}`, {
        method: 'PATCH',
        body: { ...editDraft, keyword },
      })
      window.location.reload()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed')
    }
  }

  async function toggleKeywordActive(kw: Keyword) {
    try {
      await requestJson(`/api/admin/seo/keywords/${encodeURIComponent(kw.id)}`, {
        method: 'PATCH',
        body: { isActive: !kw.isActive },
      })
      window.location.reload()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed')
    }
  }

  const usedQuota = serpUsage?.count || 0
  const quotaLimit = 250
  const quotaPercent = (usedQuota / quotaLimit) * 100
  const visibleKeywords = showInactive ? keywords : keywords.filter((k) => k.isActive)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">SEO 工具</h1>
        <p className="text-muted-foreground">
          关键词排名监控与 Google Search Console 数据分析
        </p>
      </div>

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-sm font-medium">使用说明</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <span className="text-foreground font-medium">同步 GSC 数据</span>：拉取最近 7 天的 Google Search Console 查询数据并写入数据库（需要配置 <span className="font-mono text-foreground">GOOGLE_SERVICE_ACCOUNT_JSON</span> 或 <span className="font-mono text-foreground">GOOGLE_SERVICE_ACCOUNT_PATH</span>；如你的 Search Console 不是 domain property，可设置 <span className="font-mono text-foreground">GSC_SITE_URL</span> 为 <span className="font-mono text-foreground">https://seichigo.com/</span> 这类 URL-prefix）。
            </li>
            <li>
              <span className="text-foreground font-medium">关键词排名</span>：点击「检查」会用 SerpApi 查询 Google 前 100 条结果，找到本站域名 <span className="font-mono text-foreground">seichigo.com</span> 的排名并记录到历史（每次检查消耗 1 次本月配额）。
            </li>
            <li>
              <span className="text-foreground font-medium">关键词管理</span>：可在本页新增/编辑/停用关键词；默认只展示活跃词。
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* API Quota Card */}
      <Card className="border-l-4 border-l-blue-500">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">API 配额使用</CardTitle>
          <Database className="h-4 w-4 text-blue-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {usedQuota} / {quotaLimit}
          </div>
          <div className="mt-2 h-2 w-full bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${
                quotaPercent > 80 ? 'bg-red-500' : quotaPercent > 50 ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${quotaPercent}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            SerpApi 本月使用量 ({quotaPercent.toFixed(1)}%)
          </p>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex gap-4">
        <button
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? '同步中...' : '同步 GSC 数据'}
        </button>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>最近</span>
          <input
            type="number"
            min={1}
            max={365}
            value={syncDays}
            onChange={(e) => setSyncDays(Number.parseInt(e.target.value || '7', 10) || 7)}
            className="h-10 w-20 rounded-md border px-3 text-sm bg-background"
          />
          <span>天</span>
        </div>
      </div>

      {/* Keywords Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-green-500" />
            关键词排名
          </CardTitle>
          <span className="text-sm text-muted-foreground">
            {visibleKeywords.length} / {keywords.length} 个关键词
          </span>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="h-4 w-4"
              />
              显示已停用
            </label>

            <button
              onClick={() => {
                setCreating((v) => !v)
                setCreateDraft(emptyDraft)
                cancelEditKeyword()
              }}
              className="inline-flex items-center justify-center px-3 py-2 text-sm rounded-md border hover:bg-accent transition-colors"
            >
              {creating ? '取消新增' : '新增关键词'}
            </button>
          </div>

          {creating ? (
            <div className="mb-6 rounded-lg border p-4 space-y-3">
              <div className="text-sm font-medium">新增关键词</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
                <input
                  value={createDraft.keyword}
                  onChange={(e) => setCreateDraft({ ...createDraft, keyword: e.target.value })}
                  placeholder="关键词"
                  className="sm:col-span-2 h-10 rounded-md border px-3 text-sm bg-background"
                />
                <select
                  value={createDraft.language}
                  onChange={(e) =>
                    setCreateDraft({ ...createDraft, language: e.target.value as KeywordDraft['language'] })
                  }
                  className="h-10 rounded-md border px-3 text-sm bg-background"
                >
                  <option value="zh">zh</option>
                  <option value="ja">ja</option>
                  <option value="en">en</option>
                </select>
                <select
                  value={createDraft.category}
                  onChange={(e) =>
                    setCreateDraft({ ...createDraft, category: e.target.value as KeywordDraft['category'] })
                  }
                  className="h-10 rounded-md border px-3 text-sm bg-background"
                >
                  <option value="long-tail">long-tail</option>
                  <option value="short-tail">short-tail</option>
                </select>
                <input
                  type="number"
                  value={createDraft.priority}
                  onChange={(e) =>
                    setCreateDraft({ ...createDraft, priority: Number.parseInt(e.target.value || '0', 10) || 0 })
                  }
                  className="h-10 rounded-md border px-3 text-sm bg-background"
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={createDraft.isActive}
                    onChange={(e) => setCreateDraft({ ...createDraft, isActive: e.target.checked })}
                    className="h-4 w-4"
                  />
                  立即启用
                </label>
                <button
                  onClick={handleCreateKeyword}
                  disabled={syncing}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  保存
                </button>
              </div>
            </div>
          ) : null}

          {editingId ? (
            <div className="mb-6 rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">编辑关键词</div>
                <button
                  onClick={cancelEditKeyword}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  取消
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
                <input
                  value={editDraft.keyword}
                  onChange={(e) => setEditDraft({ ...editDraft, keyword: e.target.value })}
                  placeholder="关键词"
                  className="sm:col-span-2 h-10 rounded-md border px-3 text-sm bg-background"
                />
                <select
                  value={editDraft.language}
                  onChange={(e) => setEditDraft({ ...editDraft, language: e.target.value as KeywordDraft['language'] })}
                  className="h-10 rounded-md border px-3 text-sm bg-background"
                >
                  <option value="zh">zh</option>
                  <option value="ja">ja</option>
                  <option value="en">en</option>
                </select>
                <select
                  value={editDraft.category}
                  onChange={(e) => setEditDraft({ ...editDraft, category: e.target.value as KeywordDraft['category'] })}
                  className="h-10 rounded-md border px-3 text-sm bg-background"
                >
                  <option value="long-tail">long-tail</option>
                  <option value="short-tail">short-tail</option>
                </select>
                <input
                  type="number"
                  value={editDraft.priority}
                  onChange={(e) =>
                    setEditDraft({ ...editDraft, priority: Number.parseInt(e.target.value || '0', 10) || 0 })
                  }
                  className="h-10 rounded-md border px-3 text-sm bg-background"
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={editDraft.isActive}
                    onChange={(e) => setEditDraft({ ...editDraft, isActive: e.target.checked })}
                    className="h-4 w-4"
                  />
                  启用
                </label>
                <button
                  onClick={handleUpdateKeyword}
                  disabled={syncing}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  保存
                </button>
              </div>
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm font-medium text-muted-foreground">
                  <th className="pb-3 pr-4">关键词</th>
                  <th className="pb-3 pr-4">语言</th>
                  <th className="pb-3 pr-4">类别</th>
                  <th className="pb-3 pr-4">优先级</th>
                  <th className="pb-3 pr-4">状态</th>
                  <th className="pb-3 pr-4">最新排名</th>
                  <th className="pb-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleKeywords.map((kw) => {
                  const latestRank = kw.rankHistory[0]
                  const isChecking = checking === kw.id
                  return (
                    <tr key={kw.id} className="border-b last:border-0">
                      <td className="py-3 pr-4 font-medium">{kw.keyword}</td>
                      <td className="py-3 pr-4">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100">
                          {kw.language}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                            kw.category === 'short-tail'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {kw.category}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="text-sm font-semibold">{kw.priority}</span>
                      </td>
                      <td className="py-3 pr-4">
                        {kw.isActive ? (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            active
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                            inactive
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        {latestRank?.position ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700">
                            #{latestRank.position}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                          <button
                            onClick={() => handleRankCheck(kw.id)}
                            disabled={isChecking || syncing}
                            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                          >
                            <Search className={`h-3 w-3 ${isChecking ? 'animate-spin' : ''}`} />
                            {isChecking ? '检查中' : '检查'}
                          </button>
                          <button
                            onClick={() => startEditKeyword(kw)}
                            disabled={syncing}
                            className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            编辑
                          </button>
                          <button
                            onClick={() => toggleKeywordActive(kw)}
                            disabled={syncing}
                            className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {kw.isActive ? '停用' : '启用'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Top GSC Queries */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-500" />
            GSC 热门查询
          </CardTitle>
          <span className="text-sm text-muted-foreground">
            Top {topQueries.length} 查询
          </span>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm font-medium text-muted-foreground">
                  <th className="pb-3 pr-4">查询</th>
                  <th className="pb-3 pr-4 text-right">点击</th>
                  <th className="pb-3 text-right">展示</th>
                </tr>
              </thead>
              <tbody>
                {topQueries.map((q, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-3 pr-4 font-medium">{q.query}</td>
                    <td className="py-3 pr-4 text-right font-semibold text-green-600">
                      {q._sum.clicks?.toLocaleString() || 0}
                    </td>
                    <td className="py-3 text-right text-muted-foreground">
                      {q._sum.impressions?.toLocaleString() || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
