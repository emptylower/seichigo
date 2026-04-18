import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAllLinkAssets } from '@/lib/linkAsset/getAllLinkAssets'
import { getLinkAssetById } from '@/lib/linkAsset/getLinkAssetById'
import { readLinkAssetMarkdown } from '@/lib/linkAsset/content'

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

  it('returns bundled markdown without runtime fs access', async () => {
    const markdown = await readLinkAssetMarkdown('/content/link-assets/pilgrimage-etiquette.md')

    expect(markdown).toContain('Anime Pilgrimage Etiquette Guide')
    expect(markdown).toContain('圣地巡礼之所以神奇')
    expect(mocks.fs.readFile).not.toHaveBeenCalled()
  })
})
