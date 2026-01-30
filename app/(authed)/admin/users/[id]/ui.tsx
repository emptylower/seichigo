"use client"

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Button from '@/components/shared/Button'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

type UserDetail = {
  id: string
  email: string
  name: string | null
  isAdmin: boolean
  disabled: boolean
  createdAt: string
  articleCount?: number
}

type ArticleItem = {
  id: string
  slug: string
  title: string
  status: string
  publishedAt: string | null
  createdAt: string
}

type DraftItem = {
  id: string
  slug: string
  title: string
  status: string
  createdAt: string
  updatedAt: string
}

type FavoriteItem = {
  articleId: string
  createdAt: string
  article: {
    id: string
    slug: string
    title: string
    status: string
  }
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function AdminUserDetailClient({ id }: { id: string }) {
  const router = useRouter()
  const [user, setUser] = useState<UserDetail | null>(null)
  const [articles, setArticles] = useState<ArticleItem[]>([])
  const [drafts, setDrafts] = useState<DraftItem[]>([])
  const [favorites, setFavorites] = useState<FavoriteItem[]>([])
  
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)
  
  const [activeTab, setActiveTab] = useState<'articles' | 'drafts' | 'favorites'>('articles')

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}`)
      const data = await res.json()
      
      if (!res.ok) {
        throw new Error(data.error || '加载失败')
      }
      
      setUser(data.user)
      setArticles(data.articles || [])
      setDrafts(data.drafts || [])
      setFavorites(data.favorites || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [id])

  async function toggleAdmin() {
    if (!user) return
    const action = user.isAdmin ? '取消管理员权限' : '设为管理员'
    if (!confirm(`确定要${action}吗？`)) return

    setUpdating(true)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAdmin: !user.isAdmin }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '操作失败')
      
      setUser(data.user)
    } catch (err: any) {
      alert(err.message)
    } finally {
      setUpdating(false)
    }
  }

  async function toggleDisabled() {
    if (!user) return
    const action = user.disabled ? '启用账户' : '禁用账户'
    if (!confirm(`确定要${action}吗？`)) return

    setUpdating(true)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: !user.disabled }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '操作失败')
      
      setUser(data.user)
    } catch (err: any) {
      alert(err.message)
    } finally {
      setUpdating(false)
    }
  }

  if (loading) return <div className="text-gray-600 p-8">加载中…</div>
  if (error) return <div className="text-rose-600 p-8">错误: {error}</div>
  if (!user) return <div className="text-gray-600 p-8">用户不存在</div>

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">用户详情</h1>
        <div className="mt-1 flex items-center gap-2 text-sm text-gray-600">
          <Link href="/admin/users" className="hover:underline">返回用户列表</Link>
          <span>·</span>
          <span className="font-mono">{user.id}</span>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            {user.email}
            {user.isAdmin && <Badge variant="default">管理员</Badge>}
            {!user.isAdmin && <Badge variant="secondary">用户</Badge>}
            {user.disabled ? <Badge variant="destructive">已禁用</Badge> : <Badge variant="outline">正常</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">名称：</span>
              <span className="font-medium">{user.name || '-'}</span>
            </div>
            <div>
              <span className="text-gray-500">注册时间：</span>
              <span className="font-medium">{formatDate(user.createdAt)}</span>
            </div>
            <div>
              <span className="text-gray-500">已发布文章：</span>
              <span className="font-medium">{articles.length}</span>
            </div>
            <div>
              <span className="text-gray-500">草稿/审核中：</span>
              <span className="font-medium">{drafts.length}</span>
            </div>
          </div>
        </CardContent>
        <CardFooter className="gap-3 border-t bg-gray-50/50 py-4">
          <Button 
            onClick={toggleAdmin} 
            disabled={updating} 
            variant="ghost" 
            className="bg-white"
          >
            {user.isAdmin ? '取消管理员' : '设为管理员'}
          </Button>
          <Button 
            onClick={toggleDisabled} 
            disabled={updating} 
            variant="primary"
            className={user.disabled ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"}
          >
            {user.disabled ? '启用账户' : '禁用账户'}
          </Button>
        </CardFooter>
      </Card>

      <div className="space-y-4">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8" aria-label="Tabs">
            <button
              onClick={() => setActiveTab('articles')}
              className={`
                whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium
                ${activeTab === 'articles'
                  ? 'border-brand-500 text-brand-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'}
              `}
            >
              已发布文章 ({articles.length})
            </button>
            <button
              onClick={() => setActiveTab('drafts')}
              className={`
                whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium
                ${activeTab === 'drafts'
                  ? 'border-brand-500 text-brand-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'}
              `}
            >
              草稿箱 ({drafts.length})
            </button>
            <button
              onClick={() => setActiveTab('favorites')}
              className={`
                whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium
                ${activeTab === 'favorites'
                  ? 'border-brand-500 text-brand-600'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'}
              `}
            >
              收藏 ({favorites.length})
            </button>
          </nav>
        </div>

        <div className="min-h-[200px]">
          {activeTab === 'articles' && (
            <div className="space-y-4">
              {articles.length === 0 ? (
                <div className="text-sm text-gray-500 py-4">暂无已发布文章</div>
              ) : (
                articles.map(article => (
                  <div key={article.id} className="flex items-center justify-between rounded-lg border p-4 hover:bg-gray-50">
                    <div>
                      <Link href={`/posts/${article.slug}`} target="_blank" className="font-medium hover:underline hover:text-brand-600">
                        {article.title}
                      </Link>
                      <div className="mt-1 text-xs text-gray-500">
                        发布于 {formatDate(article.publishedAt)}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {article.status}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'drafts' && (
            <div className="space-y-4">
              {drafts.length === 0 ? (
                <div className="text-sm text-gray-500 py-4">暂无草稿</div>
              ) : (
                drafts.map(draft => (
                  <div key={draft.id} className="flex items-center justify-between rounded-lg border p-4 hover:bg-gray-50">
                    <div>
                      <span className="font-medium text-gray-900">
                        {draft.title || '(无标题)'}
                      </span>
                      <div className="mt-1 text-xs text-gray-500">
                        更新于 {formatDate(draft.updatedAt)}
                      </div>
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {draft.status}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'favorites' && (
            <div className="space-y-4">
              {favorites.length === 0 ? (
                <div className="text-sm text-gray-500 py-4">暂无收藏</div>
              ) : (
                favorites.map(fav => (
                  <div key={fav.articleId} className="flex items-center justify-between rounded-lg border p-4 hover:bg-gray-50">
                    <div>
                      <Link href={`/posts/${fav.article.slug}`} target="_blank" className="font-medium hover:underline hover:text-brand-600">
                        {fav.article.title}
                      </Link>
                      <div className="mt-1 text-xs text-gray-500">
                        收藏于 {formatDate(fav.createdAt)}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {fav.article.status}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
