import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Breadcrumbs from '@/components/layout/Breadcrumbs'
import { getLinkAssetById } from '@/lib/linkAsset/getLinkAssetById'
import { aggregateSpots } from '@/lib/linkAsset/aggregateSpots'
import MapAssetView from '@/components/resources/MapAssetView'
import ChecklistAssetView from '@/components/resources/ChecklistAssetView'
import EtiquetteAssetView from '@/components/resources/EtiquetteAssetView'
import { buildHreflangAlternates } from '@/lib/seo/alternates'
import { buildBreadcrumbListJsonLd, buildRouteItemListJsonLd } from '@/lib/seo/jsonld'
import { getSiteOrigin } from '@/lib/seo/site'

export const revalidate = 3600

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const asset = await getLinkAssetById(String(id || '').trim())

  if (!asset) {
    return { title: '未找到资源', robots: { index: false, follow: false } }
  }

  const title = asset.seoTitle_zh || asset.title_zh
  const description = asset.seoDescription_zh || asset.description_zh || ''

  return {
    title,
    description,
    alternates: {
      ...buildHreflangAlternates({
        canonicalPath: `/resources/${encodeURIComponent(asset.id)}`,
        zhPath: `/resources/${encodeURIComponent(asset.id)}`,
        enPath: `/en/resources/${encodeURIComponent(asset.id)}`,
        jaPath: `/ja/resources/${encodeURIComponent(asset.id)}`,
      }),
    },
    openGraph: {
      type: 'website',
      title,
      description,
      url: `/resources/${encodeURIComponent(asset.id)}`,
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

export default async function ResourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const asset = await getLinkAssetById(String(id || '').trim())
  if (!asset) return notFound()

  const needsSpots = asset.type === 'map' || asset.type === 'checklist'
  const spots = needsSpots
    ? await aggregateSpots({ filterByAnimeIds: asset.filterByAnimeIds, filterByCities: asset.filterByCities })
    : []

  const siteOrigin = getSiteOrigin()
  const canonicalUrl = `${siteOrigin}/resources/${encodeURIComponent(asset.id)}`

  const breadcrumbJsonLd = buildBreadcrumbListJsonLd([
    { name: '首页', url: `${siteOrigin}/` },
    { name: '资源', url: `${siteOrigin}/resources` },
    { name: asset.title_zh, url: canonicalUrl },
  ])

  const itemListJsonLd = needsSpots
    ? buildRouteItemListJsonLd(
        spots.map((s) => ({
          name_zh: s.name_zh,
          name: s.name,
          name_ja: s.name_ja,
          nearestStation_zh: s.nearestStation_zh,
          nearestStation_ja: s.nearestStation_ja,
          animeScene: s.animeScene,
          googleMapsUrl: s.googleMapsUrl,
          lat: s.lat,
          lng: s.lng,
          photoTip: s.photoTip,
          note: s.note,
        })),
        { name: asset.title_zh }
      )
    : null

  const jsonLds = [breadcrumbJsonLd, itemListJsonLd].filter(Boolean) as any[]

  return (
    <>
      {jsonLds.map((obj, idx) => (
        <script key={`${String(obj['@type'] || 'jsonld')}-${idx}`} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(obj) }} />
      ))}

      <div className="space-y-8">
        <Breadcrumbs
          items={[
            { name: '首页', href: '/' },
            { name: '资源', href: '/resources' },
            { name: asset.title_zh, href: `/resources/${encodeURIComponent(asset.id)}` },
          ]}
        />

        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">{asset.title_zh}</h1>
          {asset.description_zh ? <p className="text-sm text-gray-600">{asset.description_zh}</p> : null}
        </header>

        {asset.type === 'map' ? <MapAssetView asset={asset} spots={spots} /> : null}
        {asset.type === 'checklist' ? <ChecklistAssetView asset={asset} spots={spots} /> : null}
        {asset.type === 'etiquette' || asset.type === 'guide' ? <EtiquetteAssetView asset={asset} /> : null}
      </div>
    </>
  )
}
