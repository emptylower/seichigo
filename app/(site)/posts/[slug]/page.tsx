import { getAllPosts } from '@/lib/mdx/getAllPosts'
import { getPublicPostBySlug } from '@/lib/posts/getPublicPostBySlug'
import { getDbArticleForPublicNotice } from '@/lib/posts/getDbArticleForPublicNotice'
import { getAnimeById } from '@/lib/anime/getAllAnime'
import PostMeta from '@/components/blog/PostMeta'
import GiscusComments from '@/components/GiscusComments'
import ProgressiveImagesRuntime from '@/components/content/ProgressiveImagesRuntime'
import FavoriteButton from '@/components/content/FavoriteButton'
import type { Metadata } from 'next'
import { permanentRedirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

function extractTextExcerptFromHtml(html: string, maxLen: number = 160): string {
  const raw = String(html || '')
  const withoutTags = raw.replace(/<[^>]*>/g, ' ')
  const collapsed = withoutTags
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!collapsed) return ''
  if (collapsed.length <= maxLen) return collapsed
  return `${collapsed.slice(0, maxLen - 1).trimEnd()}…`
}

function getSiteOrigin(): string {
  return String(process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
}

export async function generateStaticParams() {
  const posts = await getAllPosts('zh')
  return posts.map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const found = await getPublicPostBySlug(slug, 'zh')
  if (!found) {
    const article = await getDbArticleForPublicNotice(slug)
    if (article && article.status !== 'published' && article.publishedAt) {
      return { title: '文章已下架' }
    }
    return { title: '未找到文章' }
  }
  const frontmatter =
    found.source === 'mdx'
      ? found.post.frontmatter
      : {
          title: found.article.title,
          slug: found.article.slug,
          animeId: found.article.animeIds?.[0] || 'unknown',
          city: found.article.city || '',
        }
  const title = String((frontmatter as any).seoTitle || frontmatter.title || 'SeichiGo')
  const description =
    String((frontmatter as any).description || '').trim() ||
    (found.source === 'db'
      ? extractTextExcerptFromHtml(found.article.contentHtml || '') ||
        `${frontmatter.animeId} · ${frontmatter.city || ''}`.trim()
      : `${frontmatter.animeId} · ${frontmatter.city || ''}`.trim())
  return {
    title,
    description,
    alternates: {
      canonical: `/posts/${frontmatter.slug}`,
    },
    openGraph: {
      type: 'article',
      title,
      description,
      url: `/posts/${frontmatter.slug}`,
    },
  }
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const found = await getPublicPostBySlug(slug, 'zh')
  if (!found) {
    const article = await getDbArticleForPublicNotice(slug)
    if (article && article.status !== 'published' && article.publishedAt) {
      return <div className="text-gray-500">文章已下架。</div>
    }
    return <div className="text-gray-500">文章未找到。</div>
  }

  const favoritesEnabled = Boolean(process.env.DATABASE_URL)
  let session: any = null
  let initialFavorited = false
  if (favoritesEnabled) {
    try {
      const { getServerAuthSession } = await import('@/lib/auth/session')
      session = await getServerAuthSession()
    } catch {
      session = null
    }
    if (session?.user?.id) {
      try {
        const { prisma } = await import('@/lib/db/prisma')
        if (found.source === 'db') {
          const hit = await prisma.favorite.findUnique({
            where: { userId_articleId: { userId: session.user.id, articleId: found.article.id } },
            select: { userId: true },
          })
          initialFavorited = Boolean(hit)
        } else {
          const hit = await (prisma as any).mdxFavorite.findUnique({
            where: { userId_slug: { userId: session.user.id, slug: found.post.frontmatter.slug } },
            select: { userId: true },
          })
          initialFavorited = Boolean(hit)
        }
      } catch {
        initialFavorited = false
      }
    }
  }

  if (found.source === 'db') {
    const canonical = found.article.slug
    if (slug !== canonical) {
      permanentRedirect(`/posts/${canonical}`)
    }
  }

  const title = found.source === 'mdx' ? found.post.frontmatter.title : found.article.title
  const city = found.source === 'mdx' ? found.post.frontmatter.city : found.article.city || ''
  const routeLength = found.source === 'mdx' ? found.post.frontmatter.routeLength : found.article.routeLength || undefined
  const publishDate =
    found.source === 'mdx'
      ? found.post.frontmatter.publishDate
      : found.article.publishedAt
        ? found.article.publishedAt.toISOString().slice(0, 10)
        : undefined

  const animeIds =
    found.source === 'mdx'
      ? [found.post.frontmatter.animeId].filter(Boolean)
      : (found.article.animeIds as string[]) || []

  const anime = await Promise.all(
    animeIds.map(async (id) => {
      const meta = await getAnimeById(id).catch(() => null)
      return { id, label: meta?.name || id }
    })
  )

  const giscusTerm = found.source === 'db' ? found.article.id : found.post.frontmatter.slug
  const canonicalSlug = found.source === 'mdx' ? found.post.frontmatter.slug : found.article.slug
  const canonicalUrl = `${getSiteOrigin()}/posts/${canonicalSlug}`
  const seoTitle = found.source === 'mdx' ? String((found.post.frontmatter as any).seoTitle || title) : title
  const description =
    found.source === 'mdx'
      ? String((found.post.frontmatter as any).description || '').trim()
      : extractTextExcerptFromHtml(found.article.contentHtml || '') || `${animeIds[0] || 'unknown'} · ${city || ''}`.trim()

  const datePublished =
    found.source === 'db'
      ? found.article.publishedAt?.toISOString?.()
      : found.post.frontmatter.publishDate
        ? new Date(found.post.frontmatter.publishDate).toISOString()
        : undefined
  const dateModified =
    found.source === 'db'
      ? found.article.updatedAt?.toISOString?.() || datePublished
      : found.post.frontmatter.updatedDate
        ? new Date(found.post.frontmatter.updatedDate).toISOString()
        : datePublished

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: seoTitle,
    description,
    datePublished,
    dateModified,
    url: canonicalUrl,
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonicalUrl },
    about: [
      ...anime.map((a) => ({ '@type': 'CreativeWork', name: a.label })),
      ...(city ? [{ '@type': 'Place', name: city }] : []),
    ],
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <article className="prose prose-pink max-w-none" data-seichi-article-content="true">
        <h1>{title}</h1>
        <PostMeta anime={anime} city={city} routeLength={routeLength} publishDate={publishDate} />
        {favoritesEnabled ? (
          <div className="not-prose mt-3 flex justify-end">
            <FavoriteButton
              target={found.source === 'db' ? { source: 'db', articleId: found.article.id } : { source: 'mdx', slug: found.post.frontmatter.slug }}
              initialFavorited={initialFavorited}
              loggedIn={Boolean(session?.user?.id)}
            />
          </div>
        ) : null}
        <div className="mt-6" />
        {found.source === 'mdx' ? (
          found.post.content
        ) : (
          <div dangerouslySetInnerHTML={{ __html: found.article.contentHtml || '' }} />
        )}
        <ProgressiveImagesRuntime />
        <div className="mt-12" />
        <GiscusComments term={giscusTerm} />
      </article>
    </>
  )
}
