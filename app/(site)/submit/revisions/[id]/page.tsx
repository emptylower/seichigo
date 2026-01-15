import { getServerAuthSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import RevisionEditClient from './ui'
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
    title: '编辑更新稿',
    description: '编辑你的更新稿并重新提交审核。',
    alternates: { canonical: `/submit/revisions/${encodeIdForPath(canonicalId)}` },
  }
}

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
        seoTitle: revision.seoTitle ?? null,
        description: revision.description ?? null,
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
