import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import SubmitEditClient from './ui'
import { sanitizeRichTextHtml } from '@/lib/richtext/sanitize'
import { renderRichTextEmbeds } from '@/lib/richtext/embeds'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

function safeDecodeURIComponent(input: string): string {
  if (!/%[0-9a-fA-F]{2}/.test(input)) return input
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function encodeIdForPath(id: string): string {
  return encodeURIComponent(id)
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const decoded = safeDecodeURIComponent(String(id || '')).trim()
  const canonicalId = decoded || String(id || '')
  return {
    title: '编辑文章',
    description: '编辑你的文章草稿并提交审核。',
    alternates: { canonical: `/submit/${encodeIdForPath(canonicalId)}` },
  }
}

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

  const sanitized = sanitizeRichTextHtml(article.contentHtml || '')
  const rendered = renderRichTextEmbeds(sanitized, article.contentJson)

  const cityLinks = await prisma.articleCity.findMany({
    where: { articleId: article.id },
    orderBy: { cityId: 'asc' },
    select: {
      cityId: true,
      city: { select: { id: true, slug: true, name_zh: true, name_en: true, name_ja: true } },
    },
  })
  const cityIds = cityLinks.map((x) => x.cityId)
  const cities = cityLinks.map((x) => x.city)

  return (
    <SubmitEditClient
      initial={{
        id: article.id,
        title: article.title,
        seoTitle: article.seoTitle ?? null,
        description: article.description ?? null,
        animeIds: article.animeIds,
        city: article.city,
        cityIds,
        cities,
        routeLength: article.routeLength,
        tags: article.tags,
        cover: article.cover,
        contentJson: article.contentJson,
        contentHtml: rendered,
        status: article.status as any,
        rejectReason: article.rejectReason,
        updatedAt: article.updatedAt.toISOString(),
      }}
    />
  )
}
