import { describe, it, expect } from 'vitest'
import { extractTextNodes, replaceTextNodes } from '@/lib/translation/tiptap'
import type { SeichiRouteSpotV1 } from '@/lib/route/schema'

type TipTapNode = {
  type: string
  content?: TipTapNode[]
  text?: string
  attrs?: Record<string, any>
  [key: string]: any
}

describe('Translation - seichiRoute nodes', () => {
  describe('extractTextNodes', () => {
    it('should extract translatable strings from seichiRoute nodes', () => {
      const doc: TipTapNode = {
        type: 'doc',
        content: [
          {
            type: 'seichiRoute',
            attrs: {
              id: 'route-1',
              data: {
                version: 1,
                title: '东京巡礼路线',
                spots: [
                  {
                    name_zh: '东京站',
                    nearestStation_zh: '东京站',
                    photoTip: '新干线出发点，建议早上拍摄',
                    note: '东海道新干线起点，历史悠久',
                    animeScene: 'EP01 12:34',
                    lat: 35.6813,
                    lng: 139.767066,
                    googleMapsUrl: 'https://maps.google.com/?q=35.6813,139.767066'
                  },
                  {
                    name_zh: '秋叶原',
                    nearestStation_zh: '秋叶原站',
                    photoTip: '电器街标志性建筑',
                    note: '动漫文化圣地',
                    animeScene: 'EP02 05:12'
                  }
                ] as SeichiRouteSpotV1[]
              }
            }
          }
        ]
      }

      const texts = extractTextNodes(doc)

      // Should extract: title + 2 spots × 5 translatable fields each
      // title, name_zh, nearestStation_zh, photoTip, note, animeScene (spot 1)
      // name_zh, nearestStation_zh, photoTip, note, animeScene (spot 2)
      expect(texts).toContain('东京巡礼路线')
      expect(texts).toContain('东京站')
      expect(texts).toContain('东京站')
      expect(texts).toContain('新干线出发点，建议早上拍摄')
      expect(texts).toContain('东海道新干线起点，历史悠久')
      expect(texts).toContain('EP01 12:34')
      expect(texts).toContain('秋叶原')
      expect(texts).toContain('秋叶原站')
      expect(texts).toContain('电器街标志性建筑')
      expect(texts).toContain('动漫文化圣地')
      expect(texts).toContain('EP02 05:12')
      expect(texts.length).toBeGreaterThanOrEqual(11)
    })

    it('should NOT extract non-translatable fields from seichiRoute', () => {
      const doc: TipTapNode = {
        type: 'doc',
        content: [
          {
            type: 'seichiRoute',
            attrs: {
              id: 'route-1',
              data: {
                version: 1,
                title: '路线标题',
                spots: [
                  {
                    name: 'Tokyo Station',
                    name_ja: '東京駅',
                    name_zh: '东京站',
                    nearestStation_ja: '東京駅',
                    nearestStation_zh: '东京站',
                    lat: 35.6813,
                    lng: 139.767066,
                    googleMapsUrl: 'https://maps.google.com/?q=35.6813,139.767066'
                  }
                ] as SeichiRouteSpotV1[]
              }
            }
          }
        ]
      }

      const texts = extractTextNodes(doc)

      // Should NOT extract: name, name_ja, nearestStation_ja, lat, lng, googleMapsUrl, version, id
      expect(texts).not.toContain('Tokyo Station')
      expect(texts).not.toContain('東京駅')
      expect(texts).not.toContain(35.6813)
      expect(texts).not.toContain(139.767066)
      expect(texts).not.toContain('https://maps.google.com/?q=35.6813,139.767066')
      expect(texts).not.toContain(1)
      expect(texts).not.toContain('route-1')

      // Should extract: title, name_zh, nearestStation_zh
      expect(texts).toContain('路线标题')
      expect(texts).toContain('东京站')
      expect(texts).toContain('东京站')
    })

    it('should handle empty spots array', () => {
      const doc: TipTapNode = {
        type: 'doc',
        content: [
          {
            type: 'seichiRoute',
            attrs: {
              id: 'route-empty',
              data: {
                version: 1,
                title: '空路线',
                spots: []
              }
            }
          }
        ]
      }

      const texts = extractTextNodes(doc)

      // Should only extract title
      expect(texts).toContain('空路线')
      expect(texts.length).toBe(1)
    })

    it('should extract from mixed content (text nodes + seichiRoute)', () => {
      const doc: TipTapNode = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '这是一段介绍文字' }]
          },
          {
            type: 'seichiRoute',
            attrs: {
              id: 'route-1',
              data: {
                version: 1,
                title: '路线标题',
                spots: [
                  {
                    name_zh: '地点名',
                    photoTip: '拍照提示'
                  }
                ] as SeichiRouteSpotV1[]
              }
            }
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '结尾文字' }]
          }
        ]
      }

      const texts = extractTextNodes(doc)

      // Should extract all: paragraph texts + route data
      expect(texts).toContain('这是一段介绍文字')
      expect(texts).toContain('路线标题')
      expect(texts).toContain('地点名')
      expect(texts).toContain('拍照提示')
      expect(texts).toContain('结尾文字')
      expect(texts.length).toBe(5)
    })

    it('should deduplicate identical text across spots', () => {
      const doc: TipTapNode = {
        type: 'doc',
        content: [
          {
            type: 'seichiRoute',
            attrs: {
              id: 'route-1',
              data: {
                version: 1,
                title: '路线',
                spots: [
                  {
                    name_zh: '东京站',
                    nearestStation_zh: '东京站',
                    photoTip: '拍照提示'
                  },
                  {
                    name_zh: '东京站',
                    nearestStation_zh: '东京站',
                    photoTip: '拍照提示'
                  }
                ] as SeichiRouteSpotV1[]
              }
            }
          }
        ]
      }

      const texts = extractTextNodes(doc)

      // Should deduplicate: "东京站" appears 4 times but should be extracted once
      const uniqueTexts = Array.from(new Set(texts))
      expect(uniqueTexts).toContain('路线')
      expect(uniqueTexts).toContain('东京站')
      expect(uniqueTexts).toContain('拍照提示')
      expect(uniqueTexts.length).toBe(3)
    })
  })

  describe('replaceTextNodes', () => {
    it('should inject translations back into seichiRoute data', () => {
      const doc: TipTapNode = {
        type: 'doc',
        content: [
          {
            type: 'seichiRoute',
            attrs: {
              id: 'route-1',
              data: {
                version: 1,
                title: '东京路线',
                spots: [
                  {
                    name_zh: '东京站',
                    nearestStation_zh: '东京站',
                    photoTip: '拍照提示',
                    note: '备注',
                    animeScene: 'EP01',
                    lat: 35.6813,
                    lng: 139.767066,
                    googleMapsUrl: 'https://maps.google.com/?q=35.6813,139.767066'
                  }
                ] as SeichiRouteSpotV1[]
              }
            }
          }
        ]
      }

      const translations = new Map([
        ['东京路线', 'Tokyo Route'],
        ['东京站', 'Tokyo Station'],
        ['拍照提示', 'Photo Tip'],
        ['备注', 'Note'],
        ['EP01', 'EP01']
      ])

      const result = replaceTextNodes(doc, translations)

      // Should replace translatable fields
      const routeData = result.content?.[0].attrs?.data
      expect(routeData.title).toBe('Tokyo Route')
      expect(routeData.spots[0].name_zh).toBe('Tokyo Station')
      expect(routeData.spots[0].nearestStation_zh).toBe('Tokyo Station')
      expect(routeData.spots[0].photoTip).toBe('Photo Tip')
      expect(routeData.spots[0].note).toBe('Note')
      expect(routeData.spots[0].animeScene).toBe('EP01')

      // Should preserve non-translatable fields
      expect(routeData.version).toBe(1)
      expect(routeData.spots[0].lat).toBe(35.6813)
      expect(routeData.spots[0].lng).toBe(139.767066)
      expect(routeData.spots[0].googleMapsUrl).toBe('https://maps.google.com/?q=35.6813,139.767066')
      expect(result.content?.[0].attrs?.id).toBe('route-1')
    })

    it('should preserve non-translatable fields exactly', () => {
      const doc: TipTapNode = {
        type: 'doc',
        content: [
          {
            type: 'seichiRoute',
            attrs: {
              id: 'route-1',
              data: {
                version: 1,
                title: '标题',
                spots: [
                  {
                    name: 'Tokyo',
                    name_ja: '東京',
                    name_zh: '东京',
                    nearestStation_ja: '東京駅',
                    nearestStation_zh: '东京站',
                    lat: 35.6813,
                    lng: 139.767066,
                    googleMapsUrl: 'https://maps.google.com/?q=35.6813,139.767066'
                  }
                ] as SeichiRouteSpotV1[]
              }
            }
          }
        ]
      }

      const translations = new Map([
        ['标题', 'Title'],
        ['东京', 'Tokyo'],
        ['东京站', 'Tokyo Station']
      ])

      const result = replaceTextNodes(doc, translations)
      const spot = result.content?.[0].attrs?.data.spots[0]

      // Non-translatable fields should remain unchanged
      expect(spot.name).toBe('Tokyo')
      expect(spot.name_ja).toBe('東京')
      expect(spot.nearestStation_ja).toBe('東京駅')
      expect(spot.lat).toBe(35.6813)
      expect(spot.lng).toBe(139.767066)
      expect(spot.googleMapsUrl).toBe('https://maps.google.com/?q=35.6813,139.767066')

      // Translatable fields should be translated
      expect(spot.name_zh).toBe('Tokyo')
      expect(spot.nearestStation_zh).toBe('Tokyo Station')
    })

    it('should handle missing optional fields gracefully', () => {
      const doc: TipTapNode = {
        type: 'doc',
        content: [
          {
            type: 'seichiRoute',
            attrs: {
              id: 'route-1',
              data: {
                version: 1,
                title: '标题',
                spots: [
                  {
                    name_zh: '地点'
                    // All other fields are optional and missing
                  }
                ] as SeichiRouteSpotV1[]
              }
            }
          }
        ]
      }

      const translations = new Map([
        ['标题', 'Title'],
        ['地点', 'Location']
      ])

      const result = replaceTextNodes(doc, translations)
      const spot = result.content?.[0].attrs?.data.spots[0]

      // Should translate existing fields
      expect(result.content?.[0].attrs?.data.title).toBe('Title')
      expect(spot.name_zh).toBe('Location')

      // Missing fields should remain undefined
      expect(spot.photoTip).toBeUndefined()
      expect(spot.note).toBeUndefined()
      expect(spot.animeScene).toBeUndefined()
      expect(spot.lat).toBeUndefined()
      expect(spot.lng).toBeUndefined()
    })
  })
})
