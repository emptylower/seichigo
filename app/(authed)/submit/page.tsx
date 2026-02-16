import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import SubmitCenterClient from './ui'
import type { ArticleListItem } from './ui'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '创作中心',
  description: '管理草稿、投稿、更新稿与审核状态。',
  alternates: { canonical: '/submit' },
}
export const dynamic = 'force-dynamic'

function normalizeStatus(input: string): ArticleListItem['status'] {
  if (input === 'draft') return 'draft'
  if (input === 'in_review') return 'in_review'
  if (input === 'rejected') return 'rejected'
  if (input === 'published') return 'published'
  return 'draft'
}

export default async function SubmitCenterPage() {
  const session = await getServerAuthSession()
  const user = session?.user?.id ? { id: session.user.id, email: session.user.email } : null
  let initialItems: ArticleListItem[] | undefined

  if (user?.id) {
    const rows = await prisma.article.findMany({
      where: { authorId: user.id },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        rejectReason: true,
        updatedAt: true,
      },
      take: 80,
    })

    initialItems = rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      status: normalizeStatus(String(row.status)),
      rejectReason: row.rejectReason,
      updatedAt: row.updatedAt.toISOString(),
    }))
  }

  return <SubmitCenterClient user={user} initialItems={initialItems} />
}
