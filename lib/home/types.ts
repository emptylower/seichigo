import type { Anime } from '@/lib/anime/getAllAnime'
import type { CityLite } from '@/lib/city/db'
import type { PublicPostListItem } from '@/lib/posts/types'

export type HomeHeroItem = {
  src: string
  name?: string
}

export type HomeStarterItem = {
  id: 'anime' | 'city' | 'resources'
  href: string
  titleKey: string
  descKey: string
  ctaKey: string
}

export type HomePopularAnimeItem = {
  anime: Anime
  postCount: number
  cover: string | null
}

export type HomePopularCityItem = {
  city: CityLite
  postCount: number
}

export type HomePortalData = {
  featured: PublicPostListItem | null
  latestShelf: PublicPostListItem[]
  more: PublicPostListItem[]
  heroDisplay: HomeHeroItem[]
  starterSteps: HomeStarterItem[]
  popularAnime: HomePopularAnimeItem[]
  popularCities: HomePopularCityItem[]
}
