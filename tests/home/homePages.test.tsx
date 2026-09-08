import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import ChineseHomePage, { metadata as zhMetadata } from '@/app/(site)/page'
import EnglishHomePage, { metadata as enMetadata } from '@/app/en/page'
import JapaneseHomePage, { metadata as jaMetadata } from '@/app/ja/page'
import { getHomePortalData } from '@/lib/home/getHomePortalData'
import { portalDataFixture } from '../components/home/fixtures'

vi.mock('@/lib/home/getHomePortalData', () => ({
  getHomePortalData: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/components/route/RoutePreviewMap', () => ({
  RoutePreviewMap: () => <div data-testid="route-map" />,
}))
vi.mock('@/components/map/ResilientMapImage', () => ({
  default: (props: { src: string | null; alt: string }) => (
    <div data-testid="resilient-image" data-src={props.src ?? ''} aria-label={props.alt} />
  ),
}))
vi.mock('maplibre-gl', () => {
  class FakeMap {
    constructor(public options: Record<string, unknown>) {}
    on() {}
    off() {}
    addSource() {}
    getSource() {
      return undefined
    }
    addLayer() {}
    getLayer() {
      return undefined
    }
    fitBounds() {}
    remove() {}
  }
  return { default: { Map: FakeMap } }
})

describe('home page ISR failure handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    ['zh', ChineseHomePage],
    ['en', EnglishHomePage],
    ['ja', JapaneseHomePage],
  ] as const)('lets %s data failures escape instead of returning a cacheable page', async (locale, page) => {
    const failure = new Error(`${locale} home data unavailable`)
    vi.mocked(getHomePortalData).mockRejectedValueOnce(failure)

    await expect(page()).rejects.toBe(failure)
    expect(getHomePortalData).toHaveBeenCalledWith(locale)
  })
})

/** 首页三语的 title/description 与结构化数据（第十二轮第二批 SEO） */
describe('首页 metadata', () => {
  it('zh：title 与 description 覆盖圣地巡礼／行程规划／巡礼地图／巡礼攻略', () => {
    expect(zhMetadata.title).toEqual({ absolute: 'SeichiGo | 动漫圣地巡礼攻略 · AI 规划 + 全球巡礼点位地图' })
    const description = String(zhMetadata.description)
    for (const keyword of ['圣地巡礼', '行程规划', '巡礼地图', '巡礼攻略']) {
      expect(description).toContain(keyword)
    }
    expect(description.length).toBeLessThanOrEqual(120)
  })

  it('en/ja：H1 同口径的关键词进 title', () => {
    expect(String((enMetadata.title as { absolute: string }).absolute)).toContain('Anime Pilgrimage')
    expect(String((jaMetadata.title as { absolute: string }).absolute)).toContain('聖地巡礼')
  })

  it.each([
    ['zh', zhMetadata],
    ['en', enMetadata],
    ['ja', jaMetadata],
  ] as const)('%s 保留 alternates/hreflang 与 OG 图', (_locale, metadata) => {
    expect(metadata.alternates?.languages).toBeTruthy()
    expect(metadata.alternates?.canonical).toBeTruthy()
    expect(metadata.openGraph?.images).toEqual(['/opengraph-image'])
    // OG/twitter 文案与 metadata 主体保持一致，不留旧版描述
    expect(metadata.openGraph?.description).toBe(metadata.description)
  })
})

describe('首页 JSON-LD', () => {
  function scripts(container: HTMLElement): Record<string, unknown>[] {
    return [...container.querySelectorAll('script[type="application/ld+json"]')].map(
      (node) => JSON.parse(node.textContent?.replace(/\\u003c/g, '<') ?? '{}') as Record<string, unknown>,
    )
  }

  it('WebSite（带 SearchAction）与既有 FAQPage 并存', async () => {
    vi.mocked(getHomePortalData).mockResolvedValueOnce(portalDataFixture())
    const { container } = render(await ChineseHomePage())

    const types = scripts(container).map((item) => item['@type'])
    expect(types).toContain('WebSite')
    expect(types).toContain('FAQPage')

    const website = scripts(container).find((item) => item['@type'] === 'WebSite')!
    const action = website.potentialAction as { '@type': string; target: { urlTemplate: string }; 'query-input': string }
    expect(action['@type']).toBe('SearchAction')
    expect(action.target.urlTemplate).toContain('/plan/start?draft={search_term_string}')
    expect(action['query-input']).toBe('required name=search_term_string')
  })
})
