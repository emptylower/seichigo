import type { LinkAsset } from './types'
import { getBundledLinkAssets } from './static'

export async function getAllLinkAssets(): Promise<LinkAsset[]> {
  return getBundledLinkAssets()
}
