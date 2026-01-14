import { describe, expect, it } from 'vitest'
import { extractSeichiRouteEmbedsFromTipTapJson } from '@/lib/route/extract'
import { buildBlogPostingJsonLd, buildBreadcrumbListJsonLd, buildRouteItemListJsonLd } from '@/lib/seo/jsonld'

describe('post json-ld', () => {
  it('builds BlogPosting json-ld', () => {
    const obj = buildBlogPostingJsonLd({
      url: 'https://seichigo.com/posts/abc',
      title: 'T',
      description: 'D',
      siteName: 'SeichiGo',
      siteUrl: 'https://seichigo.com',
      datePublished: '2025-01-01',
      dateModified: '2025-01-02',
      inLanguage: 'zh',
      keywords: ['a', 'b'],
      about: [{ type: 'Place', name: '东京' }],
    })

    expect(obj['@type']).toBe('BlogPosting')
    expect(obj.url).toBe('https://seichigo.com/posts/abc')
    expect(obj.headline).toBe('T')
  })

  it('builds BreadcrumbList json-ld', () => {
    const obj = buildBreadcrumbListJsonLd([
      { name: '首页', url: 'https://seichigo.com/' },
      { name: '作品', url: 'https://seichigo.com/anime' },
      { name: '文章', url: 'https://seichigo.com/posts/abc' },
    ])

    expect(obj?.['@type']).toBe('BreadcrumbList')
    expect(obj?.itemListElement?.length).toBe(3)
  })

  it('builds route ItemList json-ld with Place+GeoCoordinates', () => {
    const obj = buildRouteItemListJsonLd(
      [
        {
          name_zh: '地点 A',
          lat: 35.1,
          lng: 139.2,
          googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=35.1,139.2',
        },
      ],
      { name: '路线点位' }
    )

    expect(obj?.['@type']).toBe('ItemList')
    const first = obj?.itemListElement?.[0]
    expect(first?.item?.['@type']).toBe('Place')
    expect(first?.item?.geo?.['@type']).toBe('GeoCoordinates')
  })

  it('extracts seichiRoute embeds from TipTap json', () => {
    const contentJson = {
      type: 'doc',
      content: [
        {
          type: 'seichiRoute',
          attrs: { id: 'r1', data: { version: 1, title: 'R', spots: [{ name_zh: 'A', lat: 1, lng: 2 }] } },
        },
      ],
    }
    const routes = extractSeichiRouteEmbedsFromTipTapJson(contentJson)
    expect(routes).toHaveLength(1)
    expect(routes[0]?.id).toBe('r1')
    expect(routes[0]?.route?.title).toBe('R')
  })
})

