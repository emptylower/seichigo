import { getAllPosts } from '@/lib/mdx/getAllPosts'
import { getPublicPostBySlug } from '@/lib/posts/getPublicPostBySlug'
import { getDbArticleForPublicNotice } from '@/lib/posts/getDbArticleForPublicNotice'
import { getAnimeById } from '@/lib/anime/getAllAnime'
import { extractSeichiRouteEmbedsFromTipTapJson } from '@/lib/route/extract'
import { buildBlogPostingJsonLd, buildBreadcrumbListJsonLd, buildRouteItemListJsonLd } from '@/lib/seo/jsonld'
import { getSiteOrigin } from '@/lib/seo/site'
import PostMeta from '@/components/blog/PostMeta'
import GiscusComments from '@/components/GiscusComments'
import ProgressiveImagesRuntime from '@/components/content/ProgressiveImagesRuntime'
import FavoriteButton from '@/components/content/FavoriteButton'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import ArticleToc from '@/components/toc/ArticleToc'
import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'

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

function toAbsoluteUrl(input: string | null | undefined, base: string): string | null {
  const raw = String(input || '').trim()
  if (!raw) return null
  if (raw.startsWith('//')) return null
  try {
    return new URL(raw, base).toString()
  } catch {
    return null
  }
}

function safeDecodeURIComponent(input: string): string {
  if (!/%[0-9a-fA-F]{2}/.test(input)) return input
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function encodeSlugForPath(slug: string): string {
  return encodeURIComponent(slug)
}

function encodeAnimeIdForPath(id: string): string {
  return encodeURIComponent(id)
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
      return { title: '文章已下架', robots: { index: false, follow: false } }
    }
    return { title: '未找到文章', robots: { index: false, follow: false } }
  }
  const frontmatter =
    found.source === 'mdx'
      ? found.post.frontmatter
      : {
          title: found.article.title,
          seoTitle: found.article.seoTitle ?? undefined,
          description: found.article.description ?? undefined,
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
      canonical: `/posts/${encodeSlugForPath(frontmatter.slug)}`,
    },
    openGraph: {
      type: 'article',
      title,
      description,
      url: `/posts/${encodeSlugForPath(frontmatter.slug)}`,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  }
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const found = await getPublicPostBySlug(slug, 'zh')
  if (!found) {
    const article = await getDbArticleForPublicNotice(slug)
    if (article && article.status !== 'published' && article.publishedAt) {
      return notFound()
    }
    return notFound()
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
    const requestedKey = safeDecodeURIComponent(String(slug || '')).trim()
    if (requestedKey !== canonical) {
      permanentRedirect(`/posts/${encodeSlugForPath(canonical)}`)
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
  const siteOrigin = getSiteOrigin()
  const canonicalUrl = `${siteOrigin}/posts/${encodeSlugForPath(canonicalSlug)}`
  const seoTitle =
    found.source === 'mdx'
      ? String((found.post.frontmatter as any).seoTitle || title)
      : String(found.article.seoTitle || title)
  const description =
    found.source === 'mdx'
      ? String((found.post.frontmatter as any).description || '').trim()
      : String(found.article.description || '').trim() ||
        extractTextExcerptFromHtml(found.article.contentHtml || '') ||
        `${animeIds[0] || 'unknown'} · ${city || ''}`.trim()

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

  const coverUrl = found.source === 'db' ? toAbsoluteUrl(found.article.cover, siteOrigin) : null

  const tags =
    found.source === 'mdx'
      ? (Array.isArray(found.post.frontmatter.tags) ? found.post.frontmatter.tags : [])
      : (Array.isArray(found.article.tags) ? found.article.tags : [])

  const keywords = [...anime.map((a) => a.label), city, ...tags].map((x) => String(x || '').trim()).filter(Boolean)

  const blogPostingJsonLd = buildBlogPostingJsonLd({
    url: canonicalUrl,
    title: seoTitle,
    description,
    siteName: 'SeichiGo',
    siteUrl: siteOrigin,
    imageUrl: coverUrl,
    datePublished,
    dateModified,
    inLanguage: 'zh',
    keywords,
    about: [
      ...anime.map((a) => ({ type: 'CreativeWork' as const, name: a.label })),
      ...(city ? [{ type: 'Place' as const, name: city }] : []),
    ],
  })

  const primaryAnime = anime[0] || null
  const breadcrumbItemsForJsonLd = [
    { name: '首页', url: `${siteOrigin}/` },
    { name: '作品', url: `${siteOrigin}/anime` },
    ...(primaryAnime ? [{ name: primaryAnime.label, url: `${siteOrigin}/anime/${encodeAnimeIdForPath(primaryAnime.id)}` }] : []),
    { name: seoTitle, url: canonicalUrl },
  ]
  const breadcrumbJsonLd = buildBreadcrumbListJsonLd(breadcrumbItemsForJsonLd)

  const breadcrumbItems = [
    { name: '首页', href: '/' },
    { name: '作品', href: '/anime' },
    ...(primaryAnime ? [{ name: primaryAnime.label, href: `/anime/${encodeAnimeIdForPath(primaryAnime.id)}` }] : []),
    { name: seoTitle, href: `/posts/${encodeSlugForPath(canonicalSlug)}` },
  ]

  const routeEmbeds =
    found.source === 'db'
      ? extractSeichiRouteEmbedsFromTipTapJson(found.article.contentJson)
      : []

  const routeItemLists = routeEmbeds
    .map((r) => buildRouteItemListJsonLd(r.route.spots, { name: r.route.title || '路线点位' }))
    .filter(Boolean)

  const jsonLds = [blogPostingJsonLd, breadcrumbJsonLd, ...routeItemLists].filter(Boolean) as any[]

  return (
    <>
      {jsonLds.map((obj, idx) => (
        <script
          key={`${String(obj['@type'] || 'jsonld')}-${idx}`}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(obj) }}
        />
      ))}
      <div className="mx-auto flex w-full max-w-5xl gap-8">
        <div className="hidden lg:block shrink-0">
          <ArticleToc />
        </div>
        <article className="prose prose-pink max-w-none flex-1 min-w-0" data-seichi-article-content="true">
          <div className="not-prose">
            <Breadcrumbs items={breadcrumbItems} />
          </div>
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
      </div>
    </>
  )
}
