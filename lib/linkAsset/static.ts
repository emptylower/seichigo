import linkAssets from '@/content/generated/public-link-assets.json'
import type { LinkAsset } from './types'

type BundledLinkAssetEntry = {
  asset: LinkAsset
  markdown: string | null
}

function cloneLinkAsset(asset: LinkAsset): LinkAsset {
  return {
    ...asset,
    filterByAnimeIds: asset.filterByAnimeIds ? [...asset.filterByAnimeIds] : undefined,
    filterByCities: asset.filterByCities ? [...asset.filterByCities] : undefined,
    filterByTags: asset.filterByTags ? [...asset.filterByTags] : undefined,
    relatedPosts: asset.relatedPosts ? [...asset.relatedPosts] : undefined,
  }
}

const BUNDLED_LINK_ASSETS = linkAssets as BundledLinkAssetEntry[]

const BUNDLED_LINK_ASSET_BY_ID = new Map(BUNDLED_LINK_ASSETS.map((entry) => [entry.asset.id, entry]))
const BUNDLED_LINK_ASSET_BY_CONTENT_FILE = new Map(
  BUNDLED_LINK_ASSETS
    .filter((entry) => entry.asset.contentFile)
    .map((entry) => [String(entry.asset.contentFile), entry])
)

export function getBundledLinkAssets(): LinkAsset[] {
  return BUNDLED_LINK_ASSETS.map((entry) => cloneLinkAsset(entry.asset))
}

export function getBundledLinkAssetById(id: string): LinkAsset | null {
  const entry = BUNDLED_LINK_ASSET_BY_ID.get(String(id || '').trim())
  return entry ? cloneLinkAsset(entry.asset) : null
}

export function getBundledLinkAssetMarkdown(contentFile: string | undefined): string | null {
  const key = String(contentFile || '').trim()
  if (!key) return null
  return BUNDLED_LINK_ASSET_BY_CONTENT_FILE.get(key)?.markdown ?? null
}
