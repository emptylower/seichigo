import { getCityBySlugOrRedirect } from '@/lib/city/db'
import { normalizeCityAlias } from '@/lib/city/normalize'
import { listPublishedDbPostsByCityId } from '@/lib/city/posts'
import { prisma } from '@/lib/db/prisma'
import { getAllPosts as getAllMdxPosts } from '@/lib/mdx/getAllPosts'
import { buildJaAlternates } from '@/lib/seo/alternates'
import { buildBreadcrumbListJsonLd } from '@/lib/seo/jsonld'
import { getSiteOrigin } from '@/lib/seo/site'
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

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const requestedSlug = safeDecodeURIComponent(String(id || '')).trim()
  const { city, redirectToSlug } = await getCityBySlugOrRedirect(requestedSlug).catch(() => ({ city: null as any, redirectToSlug: null as any }))
  if (redirectToSlug && redirectToSlug !== requestedSlug) {
    return {
      title: '移動しました',
      alternates: { canonical: `/ja/city/${encodeURIComponent(redirectToSlug)}` },
      robots: { index: false, follow: false },
    }
  }

  if (!city) {
    return { title: '都市が見つかりません', robots: { index: false, follow: false } }
  }

  const title = city.name_ja || city.name_en || city.name_zh
  const description = city.description_ja || city.description_en || city.description_zh || `${title}の聖地巡礼ルートとスポットリスト。`

  return {
    title,
    description,
    alternates: buildJaAlternates({
      zhPath: `/city/${encodeURIComponent(city.slug)}`,
      jaPath: `/ja/city/${encodeURIComponent(city.slug)}`,
    }),
    openGraph: {
      type: 'website',
      title,
      description,
      url: `/ja/city/${encodeURIComponent(city.slug)}`,
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

export default async function CityJaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const requestedSlug = safeDecodeURIComponent(String(id || '')).trim()
  const { city, redirectToSlug } = await getCityBySlugOrRedirect(requestedSlug).catch(() => ({ city: null as any, redirectToSlug: null as any }))
  if (redirectToSlug && redirectToSlug !== requestedSlug) {
    permanentRedirect(`/ja/city/${encodeURIComponent(redirectToSlug)}`)
  }
  if (!city) return notFound()

  const dbPosts = await listPublishedDbPostsByCityId(city.id).catch(() => [])

  const aliasRows = await prisma.cityAlias.findMany({ where: { cityId: city.id }, select: { aliasNorm: true } }).catch(() => [])
  const aliasSet = new Set<string>()
  for (const r of aliasRows) {
    if (r?.aliasNorm) aliasSet.add(r.aliasNorm)
  }
  aliasSet.add(normalizeCityAlias(city.slug))
  aliasSet.add(normalizeCityAlias(city.name_zh))
  if (city.name_en) aliasSet.add(normalizeCityAlias(city.name_en))
  if (city.name_ja) aliasSet.add(normalizeCityAlias(city.name_ja))

  const mdx = await getAllMdxPosts('zh').catch(() => [])
  const mdxPosts = mdx
    .filter((p) => {
      const norm = normalizeCityAlias(String((p as any).city || ''))
      return norm ? aliasSet.has(norm) : false
    })
    .map((p) => ({
      title: p.title,
      path: `/posts/${p.slug}`,
      animeIds: [p.animeId || 'unknown'].filter(Boolean),
      city: p.city || '',
      routeLength: p.routeLength,
      publishDate: p.publishDate,
      cover: null,
    }))

  const byPath = new Map<string, any>()
  for (const p of mdxPosts) byPath.set(p.path, p)
  for (const p of dbPosts) byPath.set(p.path, p)
  const posts = Array.from(byPath.values()).sort((a, b) => String(b.publishDate || '').localeCompare(String(a.publishDate || '')))

  const siteOrigin = getSiteOrigin()
  const canonicalUrl = `${siteOrigin}/ja/city/${encodeURIComponent(city.slug)}`

  const breadcrumbJsonLd = buildBreadcrumbListJsonLd([
    { name: 'ホーム', url: `${siteOrigin}/ja` },
    { name: '都市', url: `${siteOrigin}/ja/city` },
    { name: city.name_ja || city.name_en || city.name_zh, url: canonicalUrl },
  ])

  const placeJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: city.name_ja || city.name_en || city.name_zh,
    ...(city.description_ja || city.description_en || city.description_zh ? { description: city.description_ja || city.description_en || city.description_zh } : {}),
    ...(city.name_zh || city.name_en ? { alternateName: [city.name_zh, city.name_en].filter(Boolean) } : {}),
    ...(canonicalUrl ? { url: canonicalUrl } : {}),
  }

  const heroCover = typeof city.cover === 'string' && city.cover.trim() ? city.cover.trim() : null

  return (
    <>
      {breadcrumbJsonLd ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      ) : null}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(placeJsonLd) }} />

      <div className="space-y-8">
        <Breadcrumbs
          items={[
            { name: 'ホーム', href: '/ja' },
            { name: '都市', href: '/ja/city' },
            { name: city.name_ja || city.name_en || city.name_zh, href: `/ja/city/${encodeURIComponent(city.slug)}` },
          ]}
        />

        <div className="relative overflow-hidden rounded-3xl bg-gray-900 text-white shadow-xl">
          <div
            className="absolute inset-0 bg-cover bg-center opacity-40 blur-2xl scale-110 transition-transform duration-1000"
            style={{ backgroundImage: heroCover ? `url(${heroCover})` : 'none' }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/40 to-transparent" />

          <div className="relative z-10 flex flex-col gap-4 p-6 md:p-10">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight md:text-5xl">{city.name_ja || city.name_en || city.name_zh}</h1>
              {city.name_zh && city.name_ja ? <span className="text-sm text-gray-200 md:text-base">{city.name_zh}</span> : null}
            </div>

            {city.description_ja || city.description_en || city.description_zh ? (
              <p className="max-w-2xl text-sm text-gray-100 md:text-base">{city.description_ja || city.description_en || city.description_zh}</p>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-brand-500/90 px-3 py-1 text-xs font-medium text-white backdrop-blur-md shadow-sm">
                {posts.length} 件の記事
              </span>
              {city.name_zh ? (
                <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium text-white backdrop-blur-md shadow-sm">
                  {city.name_zh}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <section className="space-y-6">
          <div className="flex items-center gap-2 border-b pb-2">
            <h2 className="text-2xl font-bold text-gray-900">関連記事</h2>
          </div>

          {posts.length ? (
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
              <p className="text-gray-500">この都市の記事はまだありません。</p>
            </div>
          )}
        </section>

        {city.transportTips_ja || city.transportTips_en || city.transportTips_zh ? (
          <section className="card">
            <div className="text-sm font-semibold text-gray-900">交通のヒント</div>
            <div className="mt-1 text-sm text-gray-700">{city.transportTips_ja || city.transportTips_en || city.transportTips_zh}</div>
          </section>
        ) : null}
      </div>
    </>
  )
}
