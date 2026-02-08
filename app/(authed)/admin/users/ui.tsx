"use client"

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Button from '@/components/shared/Button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { AdminSkeleton } from '@/components/admin/state/AdminSkeleton'
import { AdminErrorState } from '@/components/admin/state/AdminErrorState'
import { AdminEmptyState } from '@/components/admin/state/AdminEmptyState'

type User = {
  id: string
  email: string
  name: string | null
  isAdmin: boolean
  disabled: boolean
  createdAt: string
  articleCount: number
}

type UsersResponse = {
  ok: boolean
  users: User[]
  total: number
  page: number
  pageSize: number
  error?: string
}

export default function UsersListClient() {
  const [users, setUsers] = useState<User[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const router = useRouter()

  const loadUsers = useCallback(async (nextPage = page, nextQ = debouncedSearch) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        page: nextPage.toString(),
        q: nextQ,
      })
      const res = await fetch(`/api/admin/users?${params.toString()}`)
      const data = (await res.json().catch(() => ({}))) as UsersResponse

      if (!res.ok || !data.ok) {
        throw new Error(data.error || '加载用户列表失败')
      }

      setUsers(data.users || [])
      setTotal(data.total || 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载用户列表失败')
      setUsers([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, page])

  useEffect(() => {
    const timer = setTimeout(() => {

      setDebouncedSearch(search)
      setPage(1) // Reset to page 1 on search change
    }, 500)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    void loadUsers(page, debouncedSearch)
  }, [debouncedSearch, loadUsers, page])

  const totalPages = Math.ceil(total / 20)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">用户管理</h1>
          <p className="text-muted-foreground">管理系统内的所有用户账户。</p>
        </div>
        <Button type="button" variant="ghost" onClick={() => void loadUsers(page, debouncedSearch)} disabled={loading}>
          刷新
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          placeholder="搜索邮箱或名称..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex h-10 w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>

      <div className="text-xs text-gray-500">
        共 {total} 条记录，第 {page} / {totalPages || 1} 页
      </div>

      {loading ? <AdminSkeleton rows={8} /> : null}
      {!loading && error ? <AdminErrorState message={error} onRetry={() => void loadUsers(page, debouncedSearch)} /> : null}

      {!loading && !error ? (
      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>邮箱</TableHead>
              <TableHead>名称</TableHead>
              <TableHead>角色</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>注册时间</TableHead>
              <TableHead>文章数</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  <AdminEmptyState title="暂无用户" description="当前条件下没有匹配用户。" />
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow
                  key={user.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/admin/users/${user.id}`)}
                >
                  <TableCell className="font-medium">{user.email}</TableCell>
                  <TableCell>{user.name || '-'}</TableCell>
                  <TableCell>
                    {user.isAdmin ? (
                      <Badge variant="default">管理员</Badge>
                    ) : (
                      <Badge variant="secondary">用户</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {user.disabled ? (
                      <Badge variant="destructive">禁用</Badge>
                    ) : (
                      <Badge variant="outline">正常</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {new Date(user.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>{user.articleCount}</TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <Link
                      href={`/admin/users/${user.id}`}
                      className="text-sm font-medium hover:underline text-primary"
                    >
                      查看
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1 || loading}
        >
          上一页
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page >= totalPages || loading}
        >
          下一页
        </Button>
      </div>
    </div>
  )
}
