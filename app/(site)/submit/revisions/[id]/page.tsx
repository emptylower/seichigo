import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import RevisionEditClient from './ui'
import { sanitizeRichTextHtml } from '@/lib/richtext/sanitize'
import { renderRichTextEmbeds } from '@/lib/richtext/embeds'

export const metadata = { title: '编辑更新稿' }
export const dynamic = 'force-dynamic'

export default async function RevisionEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getServerAuthSession()
  if (!session?.user?.id) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">编辑更新稿</h1>
        <p className="text-gray-600">请先登录后再进行创作与投稿。</p>
        <a className="btn-primary inline-flex w-fit" href={`/auth/signin?callbackUrl=${encodeURIComponent(`/submit/revisions/${id}`)}`}>
          去登录
        </a>
      </div>
    )
  }

  const revision = await prisma.articleRevision.findUnique({ where: { id } })
  if (!revision) {
    return <div className="text-gray-600">更新稿不存在。</div>
  }
  if (revision.authorId !== session.user.id) {
    return <div className="text-gray-600">无权限访问该更新稿。</div>
  }

  const sanitized = sanitizeRichTextHtml(revision.contentHtml || '')
  const rendered = renderRichTextEmbeds(sanitized, revision.contentJson)

  return (
    <RevisionEditClient
      initial={{
        id: revision.id,
        title: revision.title,
        animeIds: revision.animeIds,
        city: revision.city,
        routeLength: revision.routeLength,
        tags: revision.tags,
        cover: revision.cover,
        contentJson: revision.contentJson,
        contentHtml: rendered,
        status: revision.status as any,
        rejectReason: revision.rejectReason,
        updatedAt: revision.updatedAt.toISOString(),
      }}
    />
  )
}

