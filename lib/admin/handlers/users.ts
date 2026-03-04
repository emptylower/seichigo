import { NextResponse } from 'next/server'
import type { AdminApiDeps } from '@/lib/admin/api'
import { isAdminSession } from '@/lib/admin/handlers/common'

type UsersRouteParams = { params: Promise<{ id: string }> }

export function createHandlers(deps: AdminApiDeps) {
  return {
    async GET_LIST(request: Request) {
      const session = await deps.getSession()
      if (!isAdminSession(session)) {
        return NextResponse.json({ error: '无权限' }, { status: 403 })
      }

      const { searchParams } = new URL(request.url)
      const page = Number.parseInt(searchParams.get('page') || '1', 10)
      const q = searchParams.get('q') || ''
      const pageSize = 20
      const skip = (page - 1) * pageSize

      const where = q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' as const } },
              { name: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}

      const [users, total] = await Promise.all([
        deps.prisma.user.findMany({
          where,
          skip,
          take: pageSize,
          select: {
            id: true,
            email: true,
            name: true,
            isAdmin: true,
            disabled: true,
            createdAt: true,
            _count: {
              select: { articles: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        deps.prisma.user.count({ where }),
      ])

      const usersWithCount = users.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin,
        disabled: user.disabled,
        createdAt: user.createdAt,
        articleCount: user._count.articles,
      }))

      return NextResponse.json({
        ok: true,
        users: usersWithCount,
        total,
        page,
        pageSize,
      })
    },

    async GET_BY_ID(_request: Request, { params }: UsersRouteParams) {
      const session = await deps.getSession()
      if (!isAdminSession(session)) {
        return NextResponse.json({ error: '无权限' }, { status: 403 })
      }

      const { id: userId } = await params

      const user = await deps.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          isAdmin: true,
          disabled: true,
          createdAt: true,
        },
      })

      if (!user) {
        return NextResponse.json({ error: '用户不存在' }, { status: 404 })
      }

      const publishedArticles = await deps.prisma.article.findMany({
        where: {
          authorId: userId,
          status: 'published',
        },
        select: {
          id: true,
          slug: true,
          title: true,
          status: true,
          publishedAt: true,
          createdAt: true,
        },
        orderBy: { publishedAt: 'desc' },
      })

      const drafts = await deps.prisma.article.findMany({
        where: {
          authorId: userId,
          status: { in: ['draft', 'in_review'] },
        },
        select: {
          id: true,
          slug: true,
          title: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
      })

      const favorites = await deps.prisma.favorite.findMany({
        where: { userId },
        select: {
          articleId: true,
          createdAt: true,
          article: {
            select: {
              id: true,
              slug: true,
              title: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      return NextResponse.json({
        ok: true,
        user,
        articles: publishedArticles,
        drafts,
        favorites: favorites.map((favorite) => ({
          articleId: favorite.articleId,
          createdAt: favorite.createdAt,
          article: favorite.article,
        })),
      })
    },

    async PATCH_BY_ID(request: Request, { params }: UsersRouteParams) {
      const session = await deps.getSession()
      if (!isAdminSession(session)) {
        return NextResponse.json({ error: '无权限' }, { status: 403 })
      }

      const { id: userId } = await params
      const body = await request.json()

      const updates: { isAdmin?: boolean; disabled?: boolean } = {}

      if (typeof body.isAdmin === 'boolean') {
        updates.isAdmin = body.isAdmin
      }

      if (typeof body.disabled === 'boolean') {
        updates.disabled = body.disabled
      }

      if (Object.keys(updates).length === 0) {
        return NextResponse.json(
          { error: '没有有效的更新字段' },
          { status: 400 }
        )
      }

      try {
        const updatedUser = await deps.prisma.user.update({
          where: { id: userId },
          data: updates,
          select: {
            id: true,
            email: true,
            name: true,
            isAdmin: true,
            disabled: true,
            createdAt: true,
          },
        })

        return NextResponse.json({
          ok: true,
          user: updatedUser,
        })
      } catch (error: unknown) {
        const code = (error as { code?: unknown })?.code
        if (code === 'P2025') {
          return NextResponse.json({ error: '用户不存在' }, { status: 404 })
        }

        throw error
      }
    },
  }
}
