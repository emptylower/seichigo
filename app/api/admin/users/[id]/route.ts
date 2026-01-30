import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

export const runtime = 'nodejs'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: '无权限' }, { status: 403 })
    }

    const { id: userId } = await params

    const user = await prisma.user.findUnique({
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

    const publishedArticles = await prisma.article.findMany({
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

    const drafts = await prisma.article.findMany({
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

    const favorites = await prisma.favorite.findMany({
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
      favorites: favorites.map((f) => ({
        articleId: f.articleId,
        createdAt: f.createdAt,
        article: f.article,
      })),
    })
  } catch (err) {
    console.error('[api/admin/users/[id]] GET failed', err)
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user?.isAdmin) {
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

    const updatedUser = await prisma.user.update({
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
  } catch (err: any) {
    console.error('[api/admin/users/[id]] PATCH failed', err)

    if (err.code === 'P2025') {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
