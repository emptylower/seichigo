import { getCityBySlugOrRedirect } from '@/lib/city/db'
import { normalizeCityAlias } from '@/lib/city/normalize'
import { listPublishedDbPostsByCityId } from '@/lib/city/posts'
import { prisma } from '@/lib/db/prisma'
import { getAllPosts as getAllMdxPosts } from '@/lib/mdx/getAllPosts'
import { isSeoSpokePost } from '@/lib/posts/visibility'
import { buildHreflangAlternates } from '@/lib/seo/alternates'
import { buildBreadcrumbListJsonLd, serializeJsonLd } from '@/lib/seo/jsonld'
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
      title: '已移动',
      alternates: { canonical: `/city/${encodeURIComponent(redirectToSlug)}` },
      robots: { index: false, follow: false },
    }
  }

  if (!city) {
    return { title: '未找到城市', robots: { index: false, follow: false } }
  }

  const title = city.name_zh
  const description = city.description_zh || `${title} 圣地巡礼路线聚合页，汇总相关路线与文章，提供地图导航与点位清单。`

  return {
    title,
    description,
    alternates: {
      ...buildHreflangAlternates({
        canonicalPath: `/city/${encodeURIComponent(city.slug)}`,
        zhPath: `/city/${encodeURIComponent(city.slug)}`,
        enPath: `/en/city/${encodeURIComponent(city.slug)}`,
        jaPath: `/ja/city/${encodeURIComponent(city.slug)}`,
      }),
    },
    openGraph: {
      type: 'website',
      title,
      description,
      url: `/city/${encodeURIComponent(city.slug)}`,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  }
}

export default async function CityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const requestedSlug = safeDecodeURIComponent(String(id || '')).trim()
  const { city, redirectToSlug } = await getCityBySlugOrRedirect(requestedSlug).catch(() => ({ city: null as any, redirectToSlug: null as any }))
  if (redirectToSlug && redirectToSlug !== requestedSlug) {
    permanentRedirect(`/city/${encodeURIComponent(redirectToSlug)}`)
  }
  if (!city) return notFound()

  const dbPosts = await listPublishedDbPostsByCityId(city.id, 'zh').catch(() => [])

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
      tags: p.tags || [],
      publishDate: p.publishDate,
      cover: null,
    }))

  const byPath = new Map<string, any>()
  for (const p of mdxPosts) byPath.set(p.path, p)
  for (const p of dbPosts) byPath.set(p.path, p)
  const posts = Array.from(byPath.values())
    .filter((p) => !isSeoSpokePost(p))
    .sort((a, b) => String(b.publishDate || '').localeCompare(String(a.publishDate || '')))

  const siteOrigin = getSiteOrigin()
  const canonicalUrl = `${siteOrigin}/city/${encodeURIComponent(city.slug)}`

  const breadcrumbJsonLd = buildBreadcrumbListJsonLd([
    { name: '首页', url: `${siteOrigin}/` },
    { name: '城市', url: `${siteOrigin}/city` },
    { name: city.name_zh, url: canonicalUrl },
  ])

  const placeJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: city.name_zh,
    ...(city.description_zh ? { description: city.description_zh } : {}),
    ...(city.name_en || city.name_ja ? { alternateName: [city.name_en, city.name_ja].filter(Boolean) } : {}),
    ...(canonicalUrl ? { url: canonicalUrl } : {}),
  }

  const heroCover = typeof city.cover === 'string' && city.cover.trim() ? city.cover.trim() : null
  const heroDescription = city.description_zh || `${city.name_zh} 圣地巡礼路线聚合页，汇总相关路线与文章，提供地图导航与点位清单。`
  const aliasCount = aliasSet.size

  return (
    <>
      {breadcrumbJsonLd ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }} />
      ) : null}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(placeJsonLd) }} />

      <div className="space-y-8">
        <Breadcrumbs
          items={[
            { name: '首页', href: '/' },
            { name: '城市', href: '/city' },
            { name: city.name_zh, href: `/city/${encodeURIComponent(city.slug)}` },
          ]}
        />

        <div className="relative isolate overflow-hidden rounded-[2rem] border border-slate-700/40 bg-slate-950 text-white shadow-[0_28px_70px_-30px_rgba(15,23,42,0.95)]">
          <div
            className="absolute inset-0 scale-105 bg-cover bg-center opacity-30 blur-[2px] saturate-125 transition-transform duration-1000"
            style={{ backgroundImage: heroCover ? `url(${heroCover})` : 'none' }}
          />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_16%,rgba(244,114,182,0.36),transparent_45%),radial-gradient(circle_at_88%_84%,rgba(56,189,248,0.24),transparent_42%)]" />
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900/82 via-slate-900/88 to-slate-950/96" />
          <div className="absolute -left-16 top-12 h-48 w-48 rounded-full border border-white/15 bg-white/5 blur-2xl" />
          <div className="absolute -right-20 bottom-0 h-52 w-52 rounded-full border border-brand-200/20 bg-brand-300/20 blur-3xl" />

          <div className="relative z-10 grid gap-6 p-6 md:p-10 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-end">
            <div className="space-y-5">
              <div className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold tracking-[0.14em] text-white/85 backdrop-blur-sm">
                城市巡礼
              </div>

              <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                <h1 className="font-display text-4xl font-semibold tracking-tight text-white drop-shadow md:text-6xl">{city.name_zh}</h1>
                {city.name_ja ? <span className="pb-1 text-sm font-medium tracking-wide text-white/80 md:text-base">{city.name_ja}</span> : null}
              </div>

              <p className="max-w-3xl text-sm leading-8 text-slate-100/95 md:text-base">{heroDescription}</p>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <span className="rounded-full bg-brand-500/95 px-3 py-1 text-xs font-semibold text-white shadow-sm">
                  {posts.length} 篇文章
                </span>
                {city.name_en ? (
                  <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white/95 backdrop-blur-sm">
                    {city.name_en}
                  </span>
                ) : null}
                <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white/95 backdrop-blur-sm">
                  {aliasCount} 个别名索引
                </span>
              </div>
            </div>

            <aside className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-md md:p-5">
              <p className="text-[11px] font-semibold tracking-[0.16em] text-white/75">CITY SNAPSHOT</p>
              <dl className="mt-4 space-y-3 text-sm text-white/90">
                <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-2">
                  <dt className="text-white/70">内容状态</dt>
                  <dd className="font-medium">{posts.length > 0 ? '已发布' : '待补充'}</dd>
                </div>
                <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-2">
                  <dt className="text-white/70">封面氛围</dt>
                  <dd className="font-medium">{heroCover ? '实景背景' : '渐变背景'}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-white/70">交通提示</dt>
                  <dd className="font-medium">{city.transportTips_zh ? '可用' : '暂无'}</dd>
                </div>
              </dl>
            </aside>
          </div>
        </div>

        <section className="space-y-6">
          <div className="flex items-center gap-2 border-b pb-2">
            <h2 className="text-2xl font-bold text-gray-900">相关文章</h2>
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
              <p className="text-gray-500">该城市下暂无相关文章。</p>
            </div>
          )}
        </section>

        {city.transportTips_zh ? (
          <section className="card">
            <div className="text-sm font-semibold text-gray-900">交通小贴士</div>
            <div className="mt-1 text-sm text-gray-700">{city.transportTips_zh}</div>
          </section>
        ) : null}
      </div>
    </>
  )
}
