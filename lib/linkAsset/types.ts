export type LinkAssetType = 'map' | 'checklist' | 'etiquette' | 'guide'

export type LinkAsset = {
  id: string
  type: LinkAssetType
  title_zh: string
  title_en?: string
  description_zh?: string
  description_en?: string

  filterByAnimeIds?: string[]
  filterByCities?: string[]
  filterByTags?: string[]

  relatedPosts?: string[]

  contentFile?: string

  seoTitle_zh?: string
  seoTitle_en?: string
  seoDescription_zh?: string
  seoDescription_en?: string

  cover?: string
  publishDate?: string
  updatedDate?: string
}

export type LinkAssetListItem = {
  id: string
  type: LinkAssetType
  title: string
  description: string
  cover?: string
  publishDate?: string
}

export type AggregatedSpot = {
  name_zh: string
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

  fromArticleSlug?: string
  fromRouteId?: string
  animeIds?: string[]
  city?: string
}
