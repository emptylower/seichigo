import type { Metadata } from 'next'
import { buildEnAlternates } from '@/lib/seo/alternates'
import { isMapReplicaEnabled } from '@/lib/anitabi/feature'
import { buildMapShareImageUrl, parseMapShareQuery, toUrlSearchParams } from '@/lib/anitabi/share'
import { notFound } from 'next/navigation'
import AnitabiMapPageLazy from '@/components/map/AnitabiMapPageLazy'

type SearchParamsInput = Record<string, string | string[] | undefined>

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParamsInput> }): Promise<Metadata> {
  const resolved = await searchParams
  const params = toUrlSearchParams(resolved)
  const shareQuery = parseMapShareQuery(params)
  const query = params.toString()
  const path = `/en/map${query ? `?${query}` : ''}`
  const shareImage = buildMapShareImageUrl('en', shareQuery)

  return {
    title: 'Pilgrimage Map',
    description: 'Explore anime pilgrimage points by city, work, and spot with shareable map state.',
    alternates: buildEnAlternates({ zhPath: '/map' }),
    openGraph: {
      type: 'website',
      url: path,
      title: 'Pilgrimage Map',
      description: 'Explore anime pilgrimage points by city, work, and spot with shareable map state.',
      images: [shareImage],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Pilgrimage Map',
      description: 'Explore anime pilgrimage points by city, work, and spot with shareable map state.',
      images: [shareImage],
    },
  }
}

export const revalidate = 3600

export default function MapPageEn() {
  if (!isMapReplicaEnabled()) {
    notFound()
  }

  return <AnitabiMapPageLazy locale="en" />
}
