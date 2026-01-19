import fs from 'node:fs/promises'
import path from 'node:path'
import type { LinkAsset } from './types'

const ASSET_DIR = path.join(process.cwd(), 'content', 'link-assets')

export async function getAllLinkAssets(): Promise<LinkAsset[]> {
  const files = await fs.readdir(ASSET_DIR).catch(() => [])
  const list: LinkAsset[] = []

  for (const f of files.filter((x) => x.endsWith('.json'))) {
    const raw = await fs.readFile(path.join(ASSET_DIR, f), 'utf-8').catch(() => '{}')
    try {
      const parsed = JSON.parse(raw)
      const id = String(parsed?.id || '').trim()
      const type = String(parsed?.type || '').trim()
      const titleZh = String(parsed?.title_zh || '').trim()
      if (!id || !type || !titleZh) continue
      list.push(parsed as LinkAsset)
    } catch {
    }
  }

  const byId = new Map<string, LinkAsset>()
  for (const a of list) {
    if (a?.id) byId.set(a.id, a)
  }

  return Array.from(byId.values())
}
