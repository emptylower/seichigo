import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aggregateSpots } from '@/lib/linkAsset/aggregateSpots'
import { getAllLinkAssets } from '@/lib/linkAsset/getAllLinkAssets'
import { getLinkAssetById } from '@/lib/linkAsset/getLinkAssetById'
import { readLinkAssetContentHtml } from '@/lib/linkAsset/content'
import { getBundledLinkAssetContentHtml } from '@/lib/linkAsset/static'

const mocks = vi.hoisted(() => ({
  fs: {
    readdir: vi.fn(),
    readFile: vi.fn(),
  },
}))

vi.mock('node:fs/promises', () => ({
  default: mocks.fs,
}))

describe('bundled link assets', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns bundled resource descriptors without runtime fs access', async () => {
    const assets = await getAllLinkAssets()

    expect(assets.map((asset) => asset.id).sort()).toEqual([
      'pilgrimage-etiquette',
      'pilgrimage-map',
    ])
    expect(mocks.fs.readdir).not.toHaveBeenCalled()
  })

  it('returns a bundled asset by id without runtime fs access', async () => {
    const asset = await getLinkAssetById('pilgrimage-map')

    expect(asset).toEqual(
      expect.objectContaining({
        id: 'pilgrimage-map',
        title_zh: '圣地巡礼地图总览',
        type: 'map',
      })
    )
    expect(mocks.fs.readFile).not.toHaveBeenCalled()
  })

  it('returns bundled sanitized HTML without runtime fs access', async () => {
    const contentHtml = await readLinkAssetContentHtml('/content/link-assets/pilgrimage-etiquette.md')

    expect(contentHtml).toContain('<h1>')
    expect(contentHtml).toContain('Anime Pilgrimage Etiquette Guide')
    expect(contentHtml).toContain('圣地巡礼之所以神奇')
    expect(contentHtml).not.toContain('<script')
    expect(mocks.fs.readFile).not.toHaveBeenCalled()
  })

  it('preserves every horizontal rule in the real bundled MDX output', async () => {
    const assets = await getAllLinkAssets()
    let sourceRuleCount = 0

    for (const asset of assets) {
      if (!asset.contentFile) continue
      const sourceHtml = getBundledLinkAssetContentHtml(asset.contentFile) || ''
      const sanitizedHtml = await readLinkAssetContentHtml(asset.contentFile)
      const before = sourceHtml.match(/<hr\b/g)?.length ?? 0
      const after = sanitizedHtml?.match(/<hr\b/g)?.length ?? 0

      sourceRuleCount += before
      expect(after, asset.id).toBe(before)
    }

    expect(sourceRuleCount).toBeGreaterThan(0)
  })

  it('logs every time declared asset content is unavailable at runtime', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const contentFile = '/content/link-assets/missing.md'

    await expect(readLinkAssetContentHtml(contentFile)).resolves.toBeNull()
    await expect(readLinkAssetContentHtml(contentFile)).resolves.toBeNull()

    expect(errorSpy).toHaveBeenCalledTimes(2)
    expect(errorSpy).toHaveBeenNthCalledWith(
      1,
      '[degraded:resources.asset-content] declared asset content is unavailable',
      { contentFile }
    )
    expect(errorSpy).toHaveBeenNthCalledWith(
      2,
      '[degraded:resources.asset-content] declared asset content is unavailable',
      { contentFile }
    )
  })

  it('returns no spots and logs when the published article source fails', async () => {
    const reason = new Error('database unavailable')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const articleRepo = { listByStatus: vi.fn().mockRejectedValue(reason) }

    await expect(aggregateSpots({ articleRepo })).resolves.toEqual([])
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[degraded:resources\.spots\]/),
      { status: 'published' },
      reason
    )
  })
})
