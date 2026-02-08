import HomePageTemplate from '@/components/home/HomePageTemplate'
import { getHomePortalData } from '@/lib/home/getHomePortalData'
import { buildEnAlternates } from '@/lib/seo/alternates'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: { absolute: 'SeichiGo — Anime Pilgrimage Guides' },
  description: 'Long-form anime pilgrimage guides with practical spot lists, route maps, and photography tips.',
  alternates: buildEnAlternates({ zhPath: '/' }),
  openGraph: {
    type: 'website',
    url: '/en',
    title: 'SeichiGo — Anime Pilgrimage Guides',
    description: 'Long-form anime pilgrimage guides with practical spot lists, route maps, and photography tips.',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SeichiGo — Anime Pilgrimage Guides',
    description: 'Long-form anime pilgrimage guides with practical spot lists, route maps, and photography tips.',
    images: ['/twitter-image'],
  },
}

export const revalidate = 600
export const dynamic = 'force-static'

export default async function EnglishHomePage() {
  const data = await getHomePortalData('en')
  return <HomePageTemplate locale="en" data={data} />
}
