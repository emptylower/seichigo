import fs from 'node:fs/promises'
import path from 'node:path'
import type { LinkAsset } from './types'

const ASSET_DIR = path.join(process.cwd(), 'content', 'link-assets')

export async function getLinkAssetById(id: string): Promise<LinkAsset | null> {
  const key = String(id || '').trim()
  if (!key) return null

  try {
    const raw = await fs.readFile(path.join(ASSET_DIR, `${key}.json`), 'utf-8')
    const parsed = JSON.parse(raw)
    const assetId = String(parsed?.id || '').trim()
    if (!assetId) return null
    return parsed as LinkAsset
  } catch {
    return null
  }
}
