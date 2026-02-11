import type { Metadata } from 'next'
import { buildEnAlternates } from '@/lib/seo/alternates'
import AnitabiMapPageClient from '@/components/map/AnitabiMapPageClient'
import { isMapReplicaEnabled } from '@/lib/anitabi/feature'
import { notFound } from 'next/navigation'

export const metadata: Metadata = {
  title: 'Pilgrimage Map',
  description: 'Explore anime pilgrimage points by city, work, and spot with shareable map state.',
  alternates: buildEnAlternates({ zhPath: '/map' }),
  openGraph: {
    type: 'website',
    url: '/en/map',
    title: 'Pilgrimage Map',
    description: 'Explore anime pilgrimage points by city, work, and spot with shareable map state.',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pilgrimage Map',
    description: 'Explore anime pilgrimage points by city, work, and spot with shareable map state.',
    images: ['/twitter-image'],
  },
}

export const dynamic = 'force-dynamic'

export default function MapPageEn() {
  if (!isMapReplicaEnabled()) {
    notFound()
  }

  return <AnitabiMapPageClient locale="en" />
}
