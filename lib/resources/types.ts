import type { SeichiRouteEmbedV1 } from '@/lib/route/schema'

export type ResourceArticleForRoutes = {
  slug: string
  title: string
  animeIds: string[]
  city?: string
  contentJson: unknown | null
}

export type ResourceRouteSpot = {
  order: number
  spotKey: string
  label: string
  name_zh?: string
  name?: string
  name_ja?: string
  nearestStation_zh?: string
  nearestStation_ja?: string
  animeScene?: string
  googleMapsUrl?: string
  lat?: number
  lng?: number
  photoTip?: string
  note?: string
}

export type ResourceRoutePreview = {
  routeKey: string
  routeAnchorId: string
  articleSlug: string
  articleTitle: string
  animeIds: string[]
  city?: string
  routeId: string
  routeTitle: string
  route: SeichiRouteEmbedV1
  previewSpots: ResourceRouteSpot[]
  spots: ResourceRouteSpot[]
}

export type ResourceAnimeGroup = {
  animeId: string
  animeName: string
  cover: string | null
  routeCount: number
  routes: ResourceRoutePreview[]
}
