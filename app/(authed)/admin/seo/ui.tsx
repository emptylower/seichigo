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

export default function SeoUi({ keywords, topQueries, serpUsage }: Props) {
  const [syncing, setSyncing] = useState(false)
  const [checking, setChecking] = useState<string | null>(null)

  async function handleSync() {
    setSyncing(true)
    try {
      const res = await fetch('/api/admin/seo/sync', { method: 'POST' })
      const data = await res.json()
      alert(data.message || 'Sync complete')
      window.location.reload()
    } catch (err) {
      alert('Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  async function handleRankCheck(keywordId: string) {
    setChecking(keywordId)
    try {
      const res = await fetch('/api/admin/seo/rank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywordId })
      })
      const data = await res.json()
      alert(data.message || 'Check complete')
      window.location.reload()
    } catch (err) {
      alert('Check failed')
    } finally {
      setChecking(null)
    }
  }

  const usedQuota = serpUsage?.count || 0
  const quotaLimit = 250
  const quotaPercent = (usedQuota / quotaLimit) * 100

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">SEO 工具</h1>
        <p className="text-muted-foreground">
          关键词排名监控与 Google Search Console 数据分析
        </p>
      </div>

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
      </div>

      {/* Keywords Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-green-500" />
            关键词排名
          </CardTitle>
          <span className="text-sm text-muted-foreground">
            {keywords.length} 个活跃关键词
          </span>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm font-medium text-muted-foreground">
                  <th className="pb-3 pr-4">关键词</th>
                  <th className="pb-3 pr-4">语言</th>
                  <th className="pb-3 pr-4">类别</th>
                  <th className="pb-3 pr-4">优先级</th>
                  <th className="pb-3 pr-4">最新排名</th>
                  <th className="pb-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {keywords.map((kw) => {
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
                        {latestRank?.position ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700">
                            #{latestRank.position}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="py-3">
                        <button
                          onClick={() => handleRankCheck(kw.id)}
                          disabled={isChecking || syncing}
                          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                        >
                          <Search className={`h-3 w-3 ${isChecking ? 'animate-spin' : ''}`} />
                          {isChecking ? '检查中' : '检查'}
                        </button>
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
