import { NextResponse } from 'next/server'
import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  try {
    const session = await getServerAuthSession()
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: '无权限' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1', 10)
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
      prisma.user.findMany({
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
      prisma.user.count({ where }),
    ])

    const usersWithCount = users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      isAdmin: u.isAdmin,
      disabled: u.disabled,
      createdAt: u.createdAt,
      articleCount: u._count.articles,
    }))

    return NextResponse.json({
      ok: true,
      users: usersWithCount,
      total,
      page,
      pageSize,
    })
  } catch (err) {
    console.error('[api/admin/users] GET failed', err)
    return NextResponse.json(
      { error: '服务器错误' },
      { status: 500 }
    )
  }
}
