import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import EtiquetteAssetView from '@/components/resources/EtiquetteAssetView'
import { getLinkAssetById } from '@/lib/linkAsset/getLinkAssetById'

const compileMDX = vi.hoisted(() => vi.fn(() => {
  throw new Error('runtime MDX compilation is forbidden')
}))

vi.mock('next-mdx-remote/rsc', () => ({ compileMDX }))

describe('EtiquetteAssetView', () => {
  it('renders complete precompiled content without runtime MDX compilation', async () => {
    const asset = await getLinkAssetById('pilgrimage-etiquette')
    expect(asset).toBeTruthy()
    const rendered = await EtiquetteAssetView({ asset: asset! })
    const html = (rendered as ReactElement<{ dangerouslySetInnerHTML: { __html: string } }>)
      .props.dangerouslySetInnerHTML.__html

    expect(compileMDX).not.toHaveBeenCalled()
    expect(html).toContain('这份指南适用于大多数日本取景地')
    expect(html).toContain('圣地巡礼是连接你喜爱的故事与其灵感之地的绝佳方式')
    expect(html).toContain('让每个地方比你来时更好')
    expect(html).toContain('class="not-prose rounded-lg border p-3 bg-pink-50 border-pink-200 text-pink-900"')
  })
})
