/**
 * Map mode discriminator for simple vs complete (global) map views
 */
export type MapMode = 'complete' | 'simple'

/**
 * Base point feature properties used in Simple Mode
 * (Kept for backward compatibility)
 */
export type PointFeatureProperties = {
  pointId: string
  color: string
  selected: number
  userState: string
}

/**
 * Extended point feature properties for Complete (Global) Mode
 * Adds Bangumi metadata for thumbnail rendering
 */
export type GlobalPointFeatureProperties = PointFeatureProperties & {
  bangumiId: number
  imageUrl: string | null
}

/**
 * Thumbnail image loading state tracker
 * Used for progressive image loading in Complete Mode
 */
export type ThumbnailLoadState = {
  loaded: Map<string, HTMLImageElement>
  pending: Set<string>
  queue: string[]
}

/**
 * Supercluster cluster feature properties
 * Represents aggregated point clusters on the map
 */
export type ClusterFeatureProperties = {
  cluster: boolean
  cluster_id: number
  point_count: number
}
