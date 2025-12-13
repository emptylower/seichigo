import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import ArticleEditorClient from './ui'

export const metadata = { title: '编辑文章' }

export default async function SubmitEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getServerAuthSession()
  if (!session?.user?.id) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">编辑文章</h1>
        <p className="text-gray-600">请先登录后再进行创作与投稿。</p>
        <a className="btn-primary inline-flex w-fit" href={`/auth/signin?callbackUrl=${encodeURIComponent(`/submit/${id}`)}`}>
          去登录
        </a>
      </div>
    )
  }

  const article = await prisma.article.findUnique({ where: { id } })
  if (!article) {
    return <div className="text-gray-600">文章不存在。</div>
  }
  if (article.authorId !== session.user.id) {
    return <div className="text-gray-600">无权限访问该文章。</div>
  }

  return (
    <ArticleEditorClient
      initial={{
        id: article.id,
        slug: article.slug,
        title: article.title,
        animeId: article.animeId,
        city: article.city,
        routeLength: article.routeLength,
        tags: article.tags,
        contentJson: article.contentJson,
        contentHtml: article.contentHtml,
        status: article.status as any,
        rejectReason: article.rejectReason,
        updatedAt: article.updatedAt.toISOString(),
      }}
    />
  )
}

