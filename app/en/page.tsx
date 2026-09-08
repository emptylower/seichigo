import HomePageTemplate from '@/components/home/HomePageTemplate'
import { getHomePortalData } from '@/lib/home/getHomePortalData'
import { buildEnAlternates } from '@/lib/seo/alternates'
import type { Metadata } from 'next'

const TITLE = 'Anime Pilgrimage Itinerary Planner · AI Trip Planning + Global Pilgrimage Map | SeichiGo'
const DESCRIPTION =
  'Name the anime and your dates: SeichiGo AI planner builds a day-by-day pilgrimage itinerary with routes, transit and meals, backed by a global pilgrimage map and guides.'

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: buildEnAlternates({ zhPath: '/' }),
  openGraph: {
    type: 'website',
    url: '/en',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/twitter-image'],
  },
}

// 2026-09-08 首页数据变化慢，缩短再生成频率以减少过期瞬间的访客等待
export const revalidate = 1800
export const dynamic = 'force-static'

export default async function EnglishHomePage() {
  const data = await getHomePortalData('en')
  return <HomePageTemplate locale="en" data={data} />
}
