import type { LinkAsset } from './types'
import { getBundledLinkAssetById } from './static'

export async function getLinkAssetById(id: string): Promise<LinkAsset | null> {
  const key = String(id || '').trim()
  if (!key) return null
  return getBundledLinkAssetById(key)
}
