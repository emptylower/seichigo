'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Button from '@/components/shared/Button'
import { AdminSkeleton } from '@/components/admin/state/AdminSkeleton'
import { AdminErrorState } from '@/components/admin/state/AdminErrorState'

type IntentStats = {
  total: number
  last24h: number
  last7d: number
  uniqueUsers: number
  anonymous: number
  byDay: Array<{ day: string; count: number }>
}

type IntentsResponse = {
  ok?: boolean
  stats?: IntentStats
  checkoutEnabled?: boolean
  error?: string
}

/**
 * 订阅意向面板（G2）：开关状态 + 漏斗数字 + 最近 14 天每日柱状（纯 CSS 高度条）。
 * 数据来源 GET /api/admin/billing/intents（Part F）；管理面板内部页面，只做中文。
 */
export default function AdminBillingClient() {
  const [stats, setStats] = useState<IntentStats | null>(null)
  const [checkoutEnabled, setCheckoutEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/billing/intents', { method: 'GET' })
      const data = (await res.json().catch(() => ({}))) as IntentsResponse
      if (!res.ok || !data.stats) {
        throw new Error(data.error || '加载订阅意向失败')
      }
      setStats(data.stats)
      setCheckoutEnabled(data.checkoutEnabled === true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载订阅意向失败')
      setStats(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return <AdminSkeleton rows={6} />
  }

  if (error || !stats) {
    return <AdminErrorState message={error ?? '加载订阅意向失败'} onRetry={() => void load()} />
  }

  const cards = [
    { title: '总点击', value: stats.total },
    { title: '24 小时内', value: stats.last24h },
    { title: '7 天内', value: stats.last7d },
    { title: '去重用户', value: stats.uniqueUsers },
    { title: '未登录点击', value: stats.anonymous },
  ]
  const maxCount = Math.max(1, ...stats.byDay.map((d) => d.count))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">订阅意向</h1>
          <p className="text-sm text-muted-foreground">标准版“开通”按钮的点击漏斗（含未登录访客）。</p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              checkoutEnabled ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
            }`}
          >
            结账开关：{checkoutEnabled ? '已开放' : '未开放'}
          </span>
          <Button type="button" variant="ghost" onClick={() => void load()}>
            刷新
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        {cards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>最近 14 天</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.byDay.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无数据</p>
          ) : (
            <div className="flex items-end gap-1">
              {stats.byDay.map((d) => (
                <div key={d.day} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <div className="flex h-24 w-full items-end">
                    <div
                      title={`${d.day}：${d.count}`}
                      className="w-full rounded-t bg-brand-500"
                      style={{ height: `${Math.max(2, Math.round((d.count / maxCount) * 96))}px` }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-400">{d.day.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
