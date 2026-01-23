import { getAllLinkAssets } from '@/lib/linkAsset/getAllLinkAssets'
import type { LinkAsset, LinkAssetListItem } from '@/lib/linkAsset/types'
import { buildEnAlternates } from '@/lib/seo/alternates'
import ResourceCard from '@/components/resources/ResourceCard'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Resources',
  description: 'Maps and checklists for anime pilgrimages.',
  alternates: buildEnAlternates({ zhPath: '/resources' }),
  openGraph: {
    type: 'website',
    url: '/en/resources',
    title: 'Resources',
    description: 'Maps and checklists for anime pilgrimages.',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Resources',
    description: 'Maps and checklists for anime pilgrimages.',
    images: ['/twitter-image'],
  },
}

export const dynamic = 'force-dynamic'

function toListItem(asset: LinkAsset): LinkAssetListItem {
  return {
    id: asset.id,
    type: asset.type,
    title: String(asset.title_en || asset.title_zh || '').trim(),
    description: String(asset.description_en || asset.description_zh || '').trim(),
    cover: asset.cover || undefined,
    publishDate: asset.publishDate,
  }
}

export default async function ResourcesIndexEnPage() {
  const assets = await getAllLinkAssets()

  const items = assets
    .map(toListItem)
    .filter((x) => x.id && x.title)
    .filter((x) => x.type === 'map' || x.type === 'checklist')
    .sort((a, b) => a.id.localeCompare(b.id))

  return (
    <div>
      <h1 className="text-2xl font-bold">Resources</h1>
      <div className="mt-2 text-sm text-gray-600">Resource pages are designed to be linkable landing pages.</div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <ResourceCard key={it.id} item={it} />
        ))}
      </div>

      {!items.length ? <div className="mt-8 text-gray-500">No resources yet.</div> : null}
    </div>
  )
}
