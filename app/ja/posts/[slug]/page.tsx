import { getAllPosts } from '@/lib/mdx/getAllPosts'
import { getPublicPostBySlug } from '@/lib/posts/getPublicPostBySlug'
import { getDbArticleForPublicNotice } from '@/lib/posts/getDbArticleForPublicNotice'
import { getAnimeById } from '@/lib/anime/getAllAnime'
import { extractSeichiRouteEmbedsFromTipTapJson } from '@/lib/route/extract'
import { buildBlogPostingJsonLd, buildBreadcrumbListJsonLd, buildRouteItemListJsonLd } from '@/lib/seo/jsonld'
import { buildFAQPageJsonLd } from '@/lib/seo/faqJsonLd'
import PlaceJsonLd from '@/lib/seo/placeJsonLd'
import { getSiteOrigin } from '@/lib/seo/site'
import { buildJaAlternates } from '@/lib/seo/alternates'
import PostMeta from '@/components/blog/PostMeta'
import CommentSection from '@/components/comments/CommentSection'
import ProgressiveImagesRuntime from '@/components/content/ProgressiveImagesRuntime'
import FavoriteButton from '@/components/content/FavoriteButton'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import ArticleToc from '@/components/toc/ArticleToc'
import type { Metadata } from 'next'
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
  const posts = await getAllPosts('zh')
  return posts.map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  // Try to find Japanese translation first, fallback to Chinese
  let found = await getPublicPostBySlug(slug, 'ja')
  const hasJaTranslation = !!found
  if (!found) {
    found = await getPublicPostBySlug(slug, 'zh')
  }
  
  if (!found) {
    const article = await getDbArticleForPublicNotice(slug)
    if (article && article.status !== 'published' && article.publishedAt) {
      return { title: '記事は非公開です', robots: { index: false, follow: false } }
    }
    return { title: '記事が見つかりません', robots: { index: false, follow: false } }
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
    title: hasJaTranslation ? title : `${title} (中国語)`,
    description,
    alternates: buildJaAlternates({
      zhPath: `/posts/${encodeSlugForPath(frontmatter.slug)}`,
      jaPath: `/ja/posts/${encodeSlugForPath(frontmatter.slug)}`,
    }),
    openGraph: {
      type: 'article',
      title,
      description,
      url: `/ja/posts/${encodeSlugForPath(frontmatter.slug)}`,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  }
}

export default async function PostJaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  
  // Try to find Japanese translation first, fallback to Chinese
  let found = await getPublicPostBySlug(slug, 'ja')
  const hasJaTranslation = !!found
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
      permanentRedirect(`/ja/posts/${encodeSlugForPath(canonical)}`)
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

  const giscusTerm = found.source === 'db' ? found.article.id : found.post.frontmatter.slug
  const canonicalSlug = found.source === 'mdx' ? found.post.frontmatter.slug : found.article.slug
  const siteOrigin = getSiteOrigin()
  const canonicalUrl = `${siteOrigin}/ja/posts/${encodeSlugForPath(canonicalSlug)}`
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
    inLanguage: hasJaTranslation ? 'ja' : 'zh',
    keywords,
    wordCount,
    articleSection: '聖地巡礼',
    about: [
      ...anime.map((a) => ({ type: 'CreativeWork' as const, name: a.label })),
      ...(city ? [{ type: 'Place' as const, name: city }] : []),
    ],
  })

  const primaryAnime = anime[0] || null
  const breadcrumbItemsForJsonLd = [
    { name: 'ホーム', url: `${siteOrigin}/ja` },
    { name: 'アニメ', url: `${siteOrigin}/ja/anime` },
    ...(primaryAnime ? [{ name: primaryAnime.label, url: `${siteOrigin}/anime/${encodeAnimeIdForPath(primaryAnime.id)}` }] : []),
    { name: seoTitle, url: canonicalUrl },
  ]
  const breadcrumbJsonLd = buildBreadcrumbListJsonLd(breadcrumbItemsForJsonLd)

  const breadcrumbItems = [
    { name: 'ホーム', href: '/ja' },
    { name: 'アニメ', href: '/ja/anime' },
    ...(primaryAnime ? [{ name: primaryAnime.label, href: `/anime/${encodeAnimeIdForPath(primaryAnime.id)}` }] : []),
    { name: seoTitle, href: `/ja/posts/${encodeSlugForPath(canonicalSlug)}` },
  ]

  const routeEmbeds =
    found.source === 'db'
      ? extractSeichiRouteEmbedsFromTipTapJson(found.article.contentJson)
      : []

  const routeItemLists = routeEmbeds
    .map((r) => buildRouteItemListJsonLd(r.route.spots, { name: r.route.title || 'ルートスポット' }))
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
          <aside className="hidden lg:block lg:sticky lg:top-[var(--site-header-h,60px)] lg:shrink-0 lg:w-72 lg:pt-1 xl:fixed xl:left-4 xl:top-[var(--site-header-h,60px)] xl:z-30 2xl:left-10">
            <ArticleToc />
          </aside>
          <main className="min-w-0 flex-1 pb-24">
            <article className="prose prose-pink max-w-none w-full" data-seichi-article-content="true">
            <div className="not-prose">
              <Breadcrumbs items={breadcrumbItems} />
            </div>
            
            {/* Translation fallback notice */}
            {!hasJaTranslation && (
              <div className="not-prose my-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-start gap-3">
                  <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-amber-800">日本語翻訳は準備中です</p>
                    <p className="mt-1 text-sm text-amber-700">
                      この記事はまだ日本語に翻訳されていません。現在、中国語の原文を表示しています。
                    </p>
                  </div>
                </div>
              </div>
            )}
            
            <h1>{title}</h1>
            <PostMeta anime={anime} city={city} routeLength={routeLength} publishDate={publishDate} />
            {favoritesEnabled ? (
              <div className="not-prose mt-3 flex justify-end">
                <FavoriteButton
                  target={found.source === 'db' ? { source: 'db', articleId: found.article.id } : { source: 'mdx', slug: found.post.frontmatter.slug }}
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
