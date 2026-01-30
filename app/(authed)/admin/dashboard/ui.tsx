"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { 
  FileText, 
  CheckCircle, 
  Film, 
  MapPin, 
  Users, 
  Clock,
  ArrowRight
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import Button from "@/components/shared/Button"

type Stats = {
  pendingArticles: number
  publishedArticles: number
  animeCount: number
  cityCount: number
  userCount: number
  waitlistCount: number
}

type ArticleItem = {
  id: string
  title: string
  status: string
  updatedAt?: string
  slug?: string
}

type StatsResponse = { ok: true; stats: Stats } | { error: string }
type ArticleListResponse = { ok: true; items: ArticleItem[] } | { error: string }

export default function AdminDashboardClient() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [recentArticles, setRecentArticles] = useState<ArticleItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      try {
        const [statsRes, articlesRes] = await Promise.all([
          fetch("/api/admin/stats"),
          fetch("/api/admin/review/articles?status=in_review")
        ])

        const statsData = (await statsRes.json()) as StatsResponse
        const articlesData = (await articlesRes.json()) as ArticleListResponse

        if (!statsRes.ok || "error" in statsData) {
          throw new Error("error" in statsData ? statsData.error : "Failed to load stats")
        }
        if (!articlesRes.ok || "error" in articlesData) {
          throw new Error("error" in articlesData ? articlesData.error : "Failed to load articles")
        }

        setStats(statsData.stats)
        setRecentArticles((articlesData.items || []).slice(0, 5))
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred")
      } finally {
        setLoading(false)
      }
    }

    void loadData()
  }, [])

  if (loading) {
    return <div className="p-8 text-center text-gray-500">加载中...</div>
  }

  if (error) {
    return <div className="p-8 text-center text-red-500">错误: {error}</div>
  }

  if (!stats) return null

  const statCards = [
    {
      title: "待审文章",
      value: stats.pendingArticles,
      icon: FileText,
      href: "/admin/review",
      color: "text-orange-500",
      description: "等待审核的投稿"
    },
    {
      title: "已发布文章",
      value: stats.publishedArticles,
      icon: CheckCircle,
      href: "/admin/panel/articles",
      color: "text-green-500",
      description: "已上线的文章"
    },
    {
      title: "作品数",
      value: stats.animeCount,
      icon: Film,
      href: "/admin/panel/anime",
      color: "text-blue-500",
      description: "收录的作品"
    },
    {
      title: "城市数",
      value: stats.cityCount,
      icon: MapPin,
      href: "/admin/panel/city",
      color: "text-purple-500",
      description: "收录的圣地"
    },
    {
      title: "用户数",
      value: stats.userCount,
      icon: Users,
      href: "/admin/users",
      color: "text-pink-500",
      description: "注册用户"
    },
    {
      title: "Waitlist",
      value: stats.waitlistCount,
      icon: Clock,
      href: "/admin/waitlist",
      color: "text-gray-500",
      description: "等待加入"
    }
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">仪表盘</h1>
        <p className="text-muted-foreground">
          概览系统数据与待处理事项
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {statCards.map((card) => {
          const Icon = card.icon
          return (
            <Link key={card.title} href={card.href}>
              <Card className="hover:bg-slate-50 transition-colors cursor-pointer h-full">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    {card.title}
                  </CardTitle>
                  <Icon className={`h-4 w-4 ${card.color}`} />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{card.value}</div>
                  <p className="text-xs text-muted-foreground">
                    {card.description}
                  </p>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>最近待审文章</CardTitle>
          </CardHeader>
          <CardContent>
            {recentArticles.length > 0 ? (
              <div className="space-y-4">
                {recentArticles.map((article) => (
                  <div
                    key={article.id}
                    className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0"
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-medium leading-none">
                        {article.title}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {article.slug || "无 slug"}
                      </p>
                    </div>
                    <Link href={`/admin/review/${article.id}`}>
                      <Button variant="ghost" className="h-8 w-8 p-0">
                         <ArrowRight className="h-4 w-4" />
                         <span className="sr-only">Review</span>
                      </Button>
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">暂无待审文章</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
