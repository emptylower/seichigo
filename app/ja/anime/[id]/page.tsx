import { getAnimeById } from '@/lib/anime/getAllAnime'
import { getPostsByAnimeId } from '@/lib/posts/getPostsByAnimeId'
import { buildJaAlternates } from '@/lib/seo/alternates'
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

function hash32(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0
  }
  return h
}

function getGradient(id: string) {
  const seed = hash32(id)
  const hue1 = seed % 360
  const hue2 = (hue1 + 40) % 360
  return `linear-gradient(135deg, hsl(${hue1} 40% 30%), hsl(${hue2} 50% 20%))`
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
  const posts = await getPostsByAnimeId(canonicalId, 'ja')
  
  if (!anime && posts.length === 0) {
    return { title: '作品が見つかりません', robots: { index: false, follow: false } }
  }

  const title = anime?.name_ja ?? anime?.name ?? canonicalId
  const summary = String(anime?.summary || '').trim()
  const fallback = `${title} 聖地巡礼作品ページ。関連ルートと記事（${posts.length} 件）をまとめ、地図ナビと巡礼スポット一覧を提供。`
  const description = summary ? `${summary} ${fallback}` : fallback

  const path = `/anime/${encodeAnimeIdForPath(canonicalId)}`
  return {
    title,
    description,
    alternates: {
      ...buildJaAlternates({
        zhPath: path,
        jaPath: `/ja${path}`,
      }),
    },
    openGraph: {
      type: 'website',
      title,
      description,
      url: `/ja${path}`,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  }
}

export default async function AnimeJaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const requestedId = safeDecodeURIComponent(String(id || '')).trim()
  const anime = await getAnimeById(requestedId).catch(() => null)
  const canonicalId = anime?.id || requestedId || String(id || '')

  if (requestedId && canonicalId && requestedId !== canonicalId) {
    permanentRedirect(`/ja/anime/${encodeAnimeIdForPath(canonicalId)}`)
  }

  const posts = await getPostsByAnimeId(canonicalId, 'ja')

  if (!anime && posts.length === 0) {
    return notFound()
  }

  const display = anime ?? { id: canonicalId, name: canonicalId, name_ja: undefined, summary: '', summary_ja: undefined, alias: [], year: undefined, cover: undefined }
  const siteOrigin = getSiteOrigin()
  const canonicalUrl = `${siteOrigin}/ja/anime/${encodeAnimeIdForPath(canonicalId)}`
  const animeWorkJsonLd = buildAnimeWorkJsonLd({
    url: canonicalUrl,
    name: display.name,
    description: display.summary,
    imageUrl: display.cover || null,
    alternateNames: Array.isArray(display.alias) ? display.alias : [],
    year: display.year || null,
    inLanguage: 'ja',
    type: 'TVSeries',
  })
  
  const breadcrumbJsonLd = buildBreadcrumbListJsonLd([
    { name: 'ホーム', url: `${siteOrigin}/ja` },
    { name: '作品', url: `${siteOrigin}/ja/anime` },
    { name: display.name, url: canonicalUrl },
  ])

  // Cover Strategy: Anime Cover > First Post Cover > Gradient
  const heroCoverRaw = display.cover || posts.find((p) => p.cover)?.cover || null
  const heroCover = heroCoverRaw
    ? optimizeAssetImgSrc(heroCoverRaw, { width: 900, quality: 78 })
    : null
  const bgGradient = getGradient(canonicalId)

  return (
    <>
      {breadcrumbJsonLd ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      ) : null}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(animeWorkJsonLd) }} />

      <div className="space-y-8">
        {/* Navigation */}
        <Breadcrumbs
          items={[
            { name: 'ホーム', href: '/ja' },
            { name: '作品', href: '/ja/anime' },
            { name: display.name, href: `/ja/anime/${encodeAnimeIdForPath(canonicalId)}` },
          ]}
        />

        {/* Hero Section */}
        <div className="relative w-full overflow-hidden rounded-3xl bg-gray-900 text-white shadow-xl">
          {/* Background Layer */}
          <div 
            className="absolute inset-0 bg-cover bg-center opacity-40 blur-2xl scale-110 transition-transform duration-1000"
            style={{ 
              backgroundImage: heroCover ? `url(${heroCover})` : 'none',
              background: heroCover ? undefined : bgGradient
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/40 to-transparent" />

          {/* Content Layer */}
          <div className="relative z-10 flex flex-col gap-6 p-6 md:flex-row md:items-start md:p-10">
            {/* Poster Card */}
            <div className="shrink-0 mx-auto md:mx-0">
              <div className="relative aspect-[3/4] w-40 overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/20 md:w-52">
                <div className="absolute inset-0" style={{ background: bgGradient }} />
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
                ) : null}
              </div>
            </div>

            {/* Text Info */}
            <div className="flex-1 space-y-4 text-center md:text-left text-white">
              <div>
                <h1 className="text-3xl font-bold leading-tight tracking-tight text-white md:text-5xl drop-shadow-md">
                  {display.name_ja ?? display.name}
                </h1>
                {display.alias?.length ? (
                  <p className="mt-2 text-sm text-gray-200 md:text-base drop-shadow-sm">
                    {display.alias.join(' / ')}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3 md:justify-start">
                {display.year ? (
                  <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium text-white backdrop-blur-md shadow-sm">
                    {display.year}
                  </span>
                ) : null}
                <span className="rounded-full bg-brand-500/90 px-3 py-1 text-xs font-medium text-white backdrop-blur-md shadow-sm">
                  {posts.length} 件の記事
                </span>
              </div>

              {display.summary_ja ?? display.summary ? (
                <p className="mx-auto max-w-2xl text-sm leading-relaxed text-gray-100 md:mx-0 md:text-base drop-shadow-sm">
                  {display.summary_ja ?? display.summary}
                </p>
              ) : (
                <p className="text-sm italic text-gray-300">概要はまだありません</p>
              )}
            </div>
          </div>
        </div>

        {/* Posts Grid Section */}
        <section className="space-y-6">
          <div className="flex items-center gap-2 border-b pb-2">
            <h2 className="text-2xl font-bold text-gray-900">関連記事</h2>
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
              <p className="text-gray-500">この作品に関連する記事はまだありません。</p>
            </div>
          )}
        </section>
      </div>
    </>
  )
}
