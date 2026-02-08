'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  CheckCircle,
  Clock,
  FileText,
  Film,
  Languages,
  MapPin,
  Users,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Button from '@/components/shared/Button'
import { AdminSkeleton } from '@/components/admin/state/AdminSkeleton'
import { AdminEmptyState } from '@/components/admin/state/AdminEmptyState'
import { AdminErrorState } from '@/components/admin/state/AdminErrorState'

type Stats = {
  pendingArticles: number
  pendingRevisions: number
  pendingReviewTotal: number
  readyTranslations: number
  publishedArticles: number
  animeCount: number
  cityCount: number
  userCount: number
  waitlistCount: number
}

type QueueItem = {
  id: string
  kind: 'article' | 'revision'
  title: string
  slug: string | null
  status: string
  updatedAt: string
  href: string
}

type SummaryResponse = {
  ok: true
  stats: Stats
  queue: {
    total: number
    items: QueueItem[]
  }
} | { error: string }

function formatTime(value: string): string {
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return value
  return new Date(ms).toLocaleString('zh-CN')
}

export default function AdminDashboardClient() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/dashboard/summary', { method: 'GET' })
      const data = (await res.json().catch(() => ({}))) as SummaryResponse
      if (!res.ok || 'error' in data) {
        throw new Error('error' in data ? data.error : '加载仪表盘失败')
      }

      setStats(data.stats)
      setQueue(data.queue.items || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载仪表盘失败')
      setStats(null)
      setQueue([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  if (loading) {
    return (
      <div className="space-y-4">
        <AdminSkeleton rows={2} compact />
        <AdminSkeleton rows={8} />
      </div>
    )
  }

  if (error) {
    return <AdminErrorState message={error} onRetry={() => void loadData()} />
  }

  if (!stats) return null

  const statCards = [
    {
      title: '待审核队列',
      value: stats.pendingReviewTotal,
      icon: FileText,
      href: '/admin/review?status=in_review',
      color: 'text-orange-500',
      description: `文章 ${stats.pendingArticles} + 修订 ${stats.pendingRevisions}`,
    },
    {
      title: '待审核翻译',
      value: stats.readyTranslations,
      icon: Languages,
      href: '/admin/translations?status=ready',
      color: 'text-indigo-500',
      description: '待处理内容任务',
    },
    {
      title: '已发布文章',
      value: stats.publishedArticles,
      icon: CheckCircle,
      href: '/admin/review?status=published',
      color: 'text-green-500',
      description: '线上可见内容',
    },
    {
      title: '作品数',
      value: stats.animeCount,
      icon: Film,
      href: '/admin/panel/anime',
      color: 'text-blue-500',
      description: '作品库管理',
    },
    {
      title: '城市数',
      value: stats.cityCount,
      icon: MapPin,
      href: '/admin/panel/city',
      color: 'text-violet-500',
      description: '城市库管理',
    },
    {
      title: '用户数',
      value: stats.userCount,
      icon: Users,
      href: '/admin/users',
      color: 'text-pink-500',
      description: '用户与权限',
    },
    {
      title: 'Waitlist',
      value: stats.waitlistCount,
      icon: Clock,
      href: '/admin/waitlist',
      color: 'text-gray-500',
      description: '候补队列',
    },
  ]

  const quickActions = [
    { label: '处理审核队列', href: '/admin/review?status=in_review' },
    { label: '处理翻译任务', href: '/admin/translations?status=ready' },
    { label: '作品管理', href: '/admin/panel/anime' },
    { label: '城市管理', href: '/admin/panel/city' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">仪表盘</h1>
          <p className="text-sm text-muted-foreground">任务驱动视图：优先处理审核与翻译积压。</p>
        </div>
        <Button type="button" variant="ghost" onClick={() => void loadData()}>
          刷新数据
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {statCards.map((card) => {
          const Icon = card.icon
          return (
            <Link key={card.title} href={card.href}>
              <Card className="h-full cursor-pointer transition hover:border-brand-200 hover:bg-slate-50">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
                  <Icon className={`h-4 w-4 ${card.color}`} />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{card.value}</div>
                  <p className="text-xs text-muted-foreground">{card.description}</p>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>待处理队列</CardTitle>
            <Link href="/admin/review?status=in_review" className="text-xs text-brand-600 hover:underline">
              查看全部
            </Link>
          </CardHeader>
          <CardContent>
            {queue.length === 0 ? (
              <AdminEmptyState title="暂无待处理项" description="当前审核队列为空。" />
            ) : (
              <div className="space-y-3">
                {queue.slice(0, 8).map((item) => (
                  <div key={`${item.kind}-${item.id}`} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                          {item.kind === 'revision' ? '修订' : '文章'}
                        </span>
                        <p className="truncate text-sm font-medium text-gray-900">{item.title}</p>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {item.slug ? `slug: ${item.slug}` : '无 slug'} · 更新于 {formatTime(item.updatedAt)}
                      </p>
                    </div>
                    <Link href={item.href}>
                      <Button variant="ghost" className="h-8 w-8 p-0" aria-label="查看详情">
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>快捷操作</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {quickActions.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="block rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
              >
                {action.label}
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
