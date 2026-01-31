import { getAnimeById } from '@/lib/anime/getAllAnime'
import { getPostsByAnimeId } from '@/lib/posts/getPostsByAnimeId'
import { buildHreflangAlternates } from '@/lib/seo/alternates'
import { buildBreadcrumbListJsonLd } from '@/lib/seo/jsonld'
import { getSiteOrigin } from '@/lib/seo/site'
import { buildAnimeWorkJsonLd } from '@/lib/seo/tvSeriesJsonLd'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import BookCover from '@/components/bookstore/BookCover'
import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'

export const revalidate = 3600

function safeDecodeURIComponent(input: string): string {
  if (!/%[0-9a-fA-F]{2}/.test(input)) return input
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

function encodeAnimeIdForPath(id: string): string {
  return encodeURIComponent(id)
}

function optimizeAssetImgSrc(input: string, opts: { width: number; quality: number }): string {
  const raw = String(input || '').trim()
  if (!raw) return raw

  const hasAbsolute = raw.startsWith('http://') || raw.startsWith('https://')
  const base = hasAbsolute ? undefined : 'https://seichigo.com'

  try {
    const url = new URL(raw, base)
    if (!url.pathname.startsWith('/assets/')) return raw
    if (!url.searchParams.has('w')) url.searchParams.set('w', String(opts.width))
    if (!url.searchParams.has('q')) url.searchParams.set('q', String(opts.quality))
    return hasAbsolute ? url.toString() : `${url.pathname}${url.search}`
  } catch {
    return raw
  }
}

export async function generateStaticParams() {
  return []
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const requestedId = safeDecodeURIComponent(String(id || '')).trim()
  const anime = await getAnimeById(requestedId).catch(() => null)
  const canonicalId = anime?.id || requestedId || String(id || '')
  const posts = await getPostsByAnimeId(canonicalId, 'zh')

  if (!anime && posts.length === 0) {
    return { title: 'Anime not found', robots: { index: false, follow: false } }
  }

  const title = anime?.name_en ?? anime?.name ?? canonicalId
  const summary = String(anime?.summary || '').trim()
  const fallback = `Pilgrimage hub page for ${title}. ${posts.length} posts available.`
  const description = summary ? `${summary} ${fallback}` : fallback

  const path = `/anime/${encodeAnimeIdForPath(canonicalId)}`
  return {
    title,
    description,
    alternates: {
      ...buildHreflangAlternates({
        canonicalPath: `/en${path}`,
        zhPath: path,
        enPath: `/en${path}`,
        jaPath: `/ja${path}`,
      }),
    },
    openGraph: {
      type: 'website',
      title,
      description,
      url: `/en${path}`,
      images: ['/opengraph-image'],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ['/twitter-image'],
    },
  }
}

export default async function AnimeEnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const requestedId = safeDecodeURIComponent(String(id || '')).trim()
  const anime = await getAnimeById(requestedId).catch(() => null)
  const canonicalId = anime?.id || requestedId || String(id || '')

  if (requestedId && canonicalId && requestedId !== canonicalId) {
    permanentRedirect(`/en/anime/${encodeAnimeIdForPath(canonicalId)}`)
  }

  const posts = await getPostsByAnimeId(canonicalId, 'zh')

  if (!anime && posts.length === 0) {
    return notFound()
  }

  const display = anime ?? { id: canonicalId, name: canonicalId, name_en: undefined, summary: '', summary_en: undefined, alias: [], year: undefined, cover: undefined }
  const siteOrigin = getSiteOrigin()
  const canonicalUrl = `${siteOrigin}/en/anime/${encodeAnimeIdForPath(canonicalId)}`

  const animeWorkJsonLd = buildAnimeWorkJsonLd({
    url: canonicalUrl,
    name: display.name,
    description: display.summary,
    imageUrl: display.cover || null,
    alternateNames: Array.isArray(display.alias) ? display.alias : [],
    year: display.year || null,
    inLanguage: 'en',
    type: 'TVSeries',
  })

  const breadcrumbJsonLd = buildBreadcrumbListJsonLd([
    { name: 'Home', url: `${siteOrigin}/en` },
    { name: 'Anime', url: `${siteOrigin}/en/anime` },
    { name: display.name, url: canonicalUrl },
  ])

  const heroCoverRaw = display.cover || posts.find((p) => p.cover)?.cover || null
  const heroCover = heroCoverRaw ? optimizeAssetImgSrc(heroCoverRaw, { width: 900, quality: 78 }) : null

  return (
    <>
      {breadcrumbJsonLd ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      ) : null}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(animeWorkJsonLd) }} />

      <div className="space-y-8">
        <Breadcrumbs
          items={[
            { name: 'Home', href: '/en' },
            { name: 'Anime', href: '/en/anime' },
            { name: display.name, href: `/en/anime/${encodeAnimeIdForPath(canonicalId)}` },
          ]}
        />

        <div className="relative w-full overflow-hidden rounded-3xl bg-gray-900 text-white shadow-xl">
          <div
            className="absolute inset-0 bg-cover bg-center opacity-40 blur-2xl scale-110 transition-transform duration-1000"
            style={{ backgroundImage: heroCover ? `url(${heroCover})` : 'none' }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/40 to-transparent" />

          <div className="relative z-10 flex flex-col gap-6 p-6 md:flex-row md:items-start md:p-10">
            <div className="shrink-0 mx-auto md:mx-0">
              <div className="relative aspect-[3/4] w-40 overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/20 md:w-52">
                {heroCover ? (
                  <img
                    src={heroCover}
                    alt={display.name}
                    width={900}
                    height={1200}
                    className="absolute inset-0 h-full w-full object-cover"
                    loading="eager"
                    decoding="async"
                    fetchPriority="high"
                  />
                ) : (
                  <div className="absolute inset-0 bg-white/10" />
                )}
              </div>
            </div>

            <div className="flex-1 space-y-4 text-center md:text-left text-white">
              <div>
                <h1 className="text-3xl font-bold leading-tight tracking-tight text-white md:text-5xl">{display.name_en ?? display.name}</h1>
                {display.alias?.length ? (
                  <p className="mt-2 text-sm text-gray-200 md:text-base">{display.alias.join(' / ')}</p>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3 md:justify-start">
                {display.year ? (
                  <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium text-white backdrop-blur-md shadow-sm">
                    {display.year}
                  </span>
                ) : null}
                <span className="rounded-full bg-brand-500/90 px-3 py-1 text-xs font-medium text-white backdrop-blur-md shadow-sm">
                  {posts.length} posts
                </span>
              </div>

              {display.summary_en ?? display.summary ? (
                <p className="mx-auto max-w-2xl text-sm leading-relaxed text-gray-100 md:mx-0 md:text-base">{display.summary_en ?? display.summary}</p>
              ) : (
                <p className="text-sm italic text-gray-300">No summary yet.</p>
              )}
            </div>
          </div>
        </div>

        <section className="space-y-6">
          <div className="flex items-center gap-2 border-b pb-2">
            <h2 className="text-2xl font-bold text-gray-900">Related Posts</h2>
          </div>

          {posts.length > 0 ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {posts.map((p) => (
                <Link key={p.path} href={p.path} className="block transition-transform hover:-translate-y-1">
                  <BookCover
                    title={p.title}
                    path={p.path}
                    animeIds={p.animeIds}
                    city={p.city}
                    routeLength={p.routeLength}
                    publishDate={p.publishDate}
                    cover={p.cover}
                    variant="shelf"
                  />
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex min-h-[200px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 py-12 text-center">
              <p className="text-gray-500">No posts found for this anime yet.</p>
            </div>
          )}
        </section>
      </div>
    </>
  )
}
