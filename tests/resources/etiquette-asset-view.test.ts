import { describe, expect, it } from 'vitest'
import EtiquetteAssetView from '@/components/resources/EtiquetteAssetView'
import { getLinkAssetById } from '@/lib/linkAsset/getLinkAssetById'

describe('EtiquetteAssetView', () => {
  it('compiles pilgrimage etiquette MDX with required components', async () => {
    const asset = await getLinkAssetById('pilgrimage-etiquette')
    expect(asset).toBeTruthy()
    const rendered = await EtiquetteAssetView({ asset: asset! })
    expect(rendered).toBeTruthy()
  })
})
