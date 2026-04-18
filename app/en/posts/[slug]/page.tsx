import { getSnapshotPostFrontmatters } from '@/lib/mdx/publicSnapshot'
import { getPublicPostBySlug } from '@/lib/posts/getPublicPostBySlug'
import { getDbArticleForPublicNotice } from '@/lib/posts/getDbArticleForPublicNotice'
import { getAnimeById } from '@/lib/anime/getAllAnime'
import { extractSeichiRouteEmbedsFromTipTapJson } from '@/lib/route/extract'
import { buildBlogPostingJsonLd, buildBreadcrumbListJsonLd, buildRouteItemListJsonLd } from '@/lib/seo/jsonld'
import { buildPostFallbackTitle } from '@/lib/seo/titleBuilder'
import { buildFAQPageJsonLd } from '@/lib/seo/faqJsonLd'
import PlaceJsonLd from '@/lib/seo/placeJsonLd'
import { getSiteOrigin } from '@/lib/seo/site'
import { buildEnAlternates } from '@/lib/seo/alternates'
import PostMeta from '@/components/blog/PostMeta'
import CommentSection from '@/components/comments/CommentSection'
import ArticleShareButtons from '@/components/content/ArticleShareButtons'
import ProgressiveImagesRuntime from '@/components/content/ProgressiveImagesRuntime'
import FavoriteButton from '@/components/content/FavoriteButton'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import EmergencyNotice from '@/components/public/EmergencyNotice'
import ArticleToc from '@/components/toc/ArticleToc'
import type { Metadata } from 'next'
import { resolvePublicOverrideForPost } from '@/lib/publicOverride/service'
import { notFound, permanentRedirect } from 'next/navigation'

export const revalidate = 3600

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
  const posts = await getSnapshotPostFrontmatters('zh')
  return posts.map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const override = await resolvePublicOverrideForPost(slug, 'en')
  if (override?.action === 'hide') {
    return { title: 'Post unavailable', robots: { index: false, follow: false } }
  }
  if (override?.action === 'redirect') {
    return { title: 'Content moved', robots: { index: false, follow: false } }
  }
  if (override?.action === 'replace-with-emergency-copy') {
    return {
      title: override.title || 'Emergency notice',
      description: override.bodyText || 'Content temporarily replaced',
      robots: { index: false, follow: false },
    }
  }
  // Try to find English translation first, fallback to Chinese
  let found = await getPublicPostBySlug(slug, 'en')
  const hasEnTranslation = !!found
  if (!found) {
    found = await getPublicPostBySlug(slug, 'zh')
  }
  
  if (!found) {
    const article = await getDbArticleForPublicNotice(slug)
    if (article && article.status !== 'published' && article.publishedAt) {
      return { title: 'Article not available', robots: { index: false, follow: false } }
    }
    return { title: 'Article not found', robots: { index: false, follow: false } }
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
  const rawSeoTitle = String((frontmatter as any).seoTitle || '').trim()
  const seoTitle = rawSeoTitle
    ? { absolute: rawSeoTitle }
    : buildPostFallbackTitle(
        String(frontmatter.title || 'SeichiGo'),
        String((frontmatter as any).animeId || ''),
        String((frontmatter as any).city || '') || null,
        'en'
      )
  const description =
    String((frontmatter as any).description || '').trim() ||
    (found.source === 'db'
      ? extractTextExcerptFromHtml(found.article.contentHtml || '') ||
        `${frontmatter.animeId} · ${frontmatter.city || ''}`.trim()
      : `${frontmatter.animeId} · ${frontmatter.city || ''}`.trim())
  
  return {
    title: hasEnTranslation ? seoTitle : { absolute: `${seoTitle.absolute} (Chinese)` },
    description,
    alternates: buildEnAlternates({
      zhPath: `/posts/${encodeSlugForPath(frontmatter.slug)}`,
      enPath: `/en/posts/${encodeSlugForPath(frontmatter.slug)}`,
    }),
    openGraph: {
      type: 'article',
      title: seoTitle.absolute,
      description,
      url: `/en/posts/${encodeSlugForPath(frontmatter.slug)}`,
    },
    twitter: {
      card: 'summary_large_image',
      title: seoTitle.absolute,
      description,
    },
  }
}

export default async function PostEnPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const override = await resolvePublicOverrideForPost(slug, 'en')
  if (override?.action === 'hide') {
    return notFound()
  }
  if (override?.action === 'redirect' && override.redirectUrl) {
    permanentRedirect(override.redirectUrl)
  }
  if (override?.action === 'replace-with-emergency-copy' && override.title && override.bodyText) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-12 lg:px-10">
        <EmergencyNotice
          title={override.title}
          bodyText={override.bodyText}
          ctaLabel={override.ctaLabel}
          ctaHref={override.ctaHref}
          badgeLabel="Emergency Notice"
        />
      </div>
    )
  }
  
  // Try to find English translation first, fallback to Chinese
  let found = await getPublicPostBySlug(slug, 'en')
  const hasEnTranslation = !!found
  if (!found) {
    found = await getPublicPostBySlug(slug, 'zh')
  }
  
  if (!found) {
    const article = await getDbArticleForPublicNotice(slug)
    if (article && article.status !== 'published' && article.publishedAt) {
      return notFound()
    }
    return notFound()
  }

  const favoritesEnabled = Boolean(process.env.DATABASE_URL)

  if (found.source === 'db') {
    const canonical = found.article.slug
    const requestedKey = safeDecodeURIComponent(String(slug || '')).trim()
    if (requestedKey !== canonical) {
      permanentRedirect(`/en/posts/${encodeSlugForPath(canonical)}`)
    }
  }

  const title = found.source === 'mdx' ? found.post.frontmatter.title : found.article.title
  const city = found.source === 'mdx' ? found.post.frontmatter.city : found.article.city || ''
  const routeLength = found.source === 'mdx' ? found.post.frontmatter.routeLength : found.article.routeLength || undefined
  const publishDate =
    found.source === 'mdx'
      ? found.post.frontmatter.publishDate
      : (() => {
          const publishedAt = (found.article.publishedAt ?? null) as unknown
          if (!publishedAt) return undefined
          if (publishedAt instanceof Date) return publishedAt.toISOString().slice(0, 10)
          if (typeof publishedAt === 'string') {
            const d = new Date(publishedAt)
            if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
          }
          return undefined
        })()

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

  const canonicalSlug = found.source === 'mdx' ? found.post.frontmatter.slug : found.article.slug
  const siteOrigin = getSiteOrigin()
  const canonicalUrl = `${siteOrigin}/en/posts/${encodeSlugForPath(canonicalSlug)}`
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

  const contentForWordCount = found.source === 'db' ? found.article.contentHtml || '' : ''
  const textContent = contentForWordCount.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  const wordCount = textContent.length

  const blogPostingJsonLd = buildBlogPostingJsonLd({
    url: canonicalUrl,
    title: seoTitle,
    description,
    siteName: 'SeichiGo',
    siteUrl: siteOrigin,
    author: { type: 'Organization', name: 'SeichiGo', url: siteOrigin },
    imageUrl: coverUrl,
    datePublished,
    dateModified,
    inLanguage: hasEnTranslation ? 'en' : 'zh',
    keywords,
    wordCount,
    articleSection: 'Anime Pilgrimage',
    about: [
      ...anime.map((a) => ({ type: 'CreativeWork' as const, name: a.label })),
      ...(city ? [{ type: 'Place' as const, name: city }] : []),
    ],
  })

  const primaryAnime = anime[0] || null
  const breadcrumbItemsForJsonLd = [
    { name: 'Home', url: `${siteOrigin}/en` },
    { name: 'Anime', url: `${siteOrigin}/en/anime` },
    ...(primaryAnime ? [{ name: primaryAnime.label, url: `${siteOrigin}/anime/${encodeAnimeIdForPath(primaryAnime.id)}` }] : []),
    { name: seoTitle, url: canonicalUrl },
  ]
  const breadcrumbJsonLd = buildBreadcrumbListJsonLd(breadcrumbItemsForJsonLd)

  const breadcrumbItems = [
    { name: 'Home', href: '/en' },
    { name: 'Anime', href: '/en/anime' },
    ...(primaryAnime ? [{ name: primaryAnime.label, href: `/anime/${encodeAnimeIdForPath(primaryAnime.id)}` }] : []),
    { name: seoTitle, href: `/en/posts/${encodeSlugForPath(canonicalSlug)}` },
  ]

  const routeEmbeds =
    found.source === 'db'
      ? extractSeichiRouteEmbedsFromTipTapJson(found.article.contentJson)
      : []

  const routeItemLists = routeEmbeds
    .map((r) => buildRouteItemListJsonLd(r.route.spots, { name: r.route.title || 'Route Spots' }))
    .filter(Boolean)

  const faqs =
    found.source === 'mdx'
      ? (((found.post.frontmatter as any).faqs as any[]) || [])
      : (((found.article as any).faqs as any[]) || [])

  const faqJsonLd = buildFAQPageJsonLd(
    Array.isArray(faqs)
      ? faqs
          .map((x) => ({
            question: String((x as any)?.question || ''),
            answer: String((x as any)?.answer || ''),
          }))
          .filter((x) => x.question && x.answer)
      : []
  )

  const jsonLds = [blogPostingJsonLd, breadcrumbJsonLd, ...routeItemLists, faqJsonLd].filter(Boolean) as any[]

  return (
    <>
      <PlaceJsonLd data={jsonLds} keyPrefix={canonicalSlug} />
      <div key={canonicalSlug} className="mx-auto w-full max-w-7xl px-6 lg:px-10" data-layout-wide="true">
        <div className="flex items-start gap-12">
          <aside className="hidden xl:block xl:sticky xl:top-[var(--site-header-h,60px)] xl:shrink-0 xl:w-72 xl:pt-1 xl:fixed xl:left-4 xl:z-30 2xl:left-10">
            <ArticleToc />
          </aside>
          <main className="min-w-0 flex-1 pb-24">
            <article className="prose prose-pink max-w-none w-full" data-seichi-article-content="true">
            <div className="not-prose">
              <Breadcrumbs items={breadcrumbItems} />
            </div>
            
            {!hasEnTranslation && (
              <div className="not-prose my-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-start gap-3">
                  <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-amber-800">English translation is not available yet</p>
                    <p className="mt-1 text-sm text-amber-700">
                      This article has not been translated to English yet. Currently showing the original Chinese content.
                    </p>
                  </div>
                </div>
              </div>
            )}
            
            <h1>{title}</h1>
            <PostMeta anime={anime} city={city} routeLength={routeLength} publishDate={publishDate} />
            <div className="not-prose mt-3 flex flex-wrap items-center justify-between gap-3">
              <ArticleShareButtons url={canonicalUrl} title={seoTitle} locale="en" tag="Seichigo" />
              {favoritesEnabled ? (
                <FavoriteButton
                  target={found.source === 'db' ? { source: 'db', articleId: found.article.id } : { source: 'mdx', slug: found.post.frontmatter.slug }}
                />
              ) : null}
            </div>
            <div className="mt-6" />
            {found.source === 'mdx' ? (
              found.post.contentHtml ? <div dangerouslySetInnerHTML={{ __html: found.post.contentHtml }} /> : found.post.content
            ) : (
              <div dangerouslySetInnerHTML={{ __html: found.article.contentHtml || '' }} />
            )}
            <ProgressiveImagesRuntime />
            <div className="mt-12" />
            {found.source === 'db' ? (
              <CommentSection articleId={found.article.id} />
            ) : (
              <CommentSection mdxSlug={found.post.frontmatter.slug} />
            )}
          </article>
          </main>
        </div>
      </div>
    </>
  )
}
