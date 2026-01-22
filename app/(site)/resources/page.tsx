import { getAllLinkAssets } from '@/lib/linkAsset/getAllLinkAssets'
import type { LinkAsset, LinkAssetListItem } from '@/lib/linkAsset/types'
import ResourceCard from '@/components/resources/ResourceCard'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '巡礼资源',
  description: '地图、清单、礼仪等可引用的圣地巡礼资源页，适合作为外链落地入口。',
  alternates: { canonical: '/resources' },
  openGraph: {
    type: 'website',
    url: '/resources',
    title: '巡礼资源',
    description: '地图、清单、礼仪等可引用的圣地巡礼资源页，适合作为外链落地入口。',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: '巡礼资源',
    description: '地图、清单、礼仪等可引用的圣地巡礼资源页，适合作为外链落地入口。',
    images: ['/twitter-image'],
  },
}

export const dynamic = 'force-dynamic'

function toListItem(asset: LinkAsset): LinkAssetListItem {
  return {
    id: asset.id,
    type: asset.type,
    title: String(asset.title_zh || '').trim(),
    description: String(asset.description_zh || '').trim(),
    cover: asset.cover || undefined,
    publishDate: asset.publishDate,
  }
}

export default async function ResourcesIndexPage() {
  const assets = await getAllLinkAssets()

  const items = assets
    .map(toListItem)
    .filter((x) => x.id && x.title)
    .filter((x) => x.type === 'map' || x.type === 'checklist')
    .sort((a, b) => a.id.localeCompare(b.id))

  return (
    <div>
      <h1 className="text-2xl font-bold">资源</h1>
      <div className="mt-2 text-sm text-gray-600">优先做“可引用”的资源页（地图/清单/礼仪），再反向导流到具体路线文章。</div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <ResourceCard key={it.id} item={it} />
        ))}
      </div>

      {!items.length ? <div className="mt-8 text-gray-500">暂无资源元数据。</div> : null}
    </div>
  )
}
