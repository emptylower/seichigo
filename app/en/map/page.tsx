import type { Metadata } from 'next'
import { buildEnAlternates } from '@/lib/seo/alternates'
import { isMapReplicaEnabled } from '@/lib/anitabi/feature'
import { getMapPageBootstrap } from '@/lib/anitabi/mapPageBootstrap'
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
  const shareImage = await buildMapShareImageUrl('en', shareQuery)

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

// Search params intentionally keep this route dynamic so shared map URLs get distinct OG images.

export default async function MapPageEn({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  if (!isMapReplicaEnabled()) {
    notFound()
  }
  const resolved = await searchParams
  const params = toUrlSearchParams(resolved)
  const tabParam = params.get('tab')
  const tab = tabParam === 'recent' || tabParam === 'hot' || tabParam === 'nearby' ? tabParam : 'latest'
  let initialBootstrap
  try {
    initialBootstrap = await getMapPageBootstrap('en', tab)
  } catch (error) {
    console.error('[degraded:map.bootstrap-ssr]', { locale: 'en', tab }, error)
    initialBootstrap = undefined
  }
  return <AnitabiMapPageLazy locale="en" initialBootstrap={initialBootstrap} />
}
