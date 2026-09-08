import { describe, expect, it } from 'vitest'
import { parseGeocodeAddresses } from '@/lib/share/geocode'

/** 手工构造的 MapTiler 反查响应（language=zh,en,ja&limit=1），不发真实请求 */
const MUSASHINO = {
  type: 'FeatureCollection',
  features: [
    {
      id: 'address.1',
      place_name_zh: '中町一丁目, 武藏野市, 东京都/東京都, 日本',
      context: [
        { id: 'neighbourhood.11', text_zh: '中町一丁目', text_en: 'Nakacho 1-chome', text_ja: '中町一丁目' },
        { id: 'postal_code.12', text: '180-0006' },
        { id: 'municipality.13', text_zh: '武藏野市', text_en: 'Musashino', text_ja: '武蔵野市' },
        { id: 'region.14', text_zh: '东京都/東京都', text_en: 'Tokyo', text_ja: '東京都' },
        { id: 'country.15', text_zh: '日本', text_en: 'Japan', text_ja: '日本' },
      ],
    },
  ],
}

describe('parseGeocodeAddresses', () => {
  it('zh/ja 由粗到细用空格拼，en 由细到粗用逗号拼', () => {
    expect(parseGeocodeAddresses(MUSASHINO)).toEqual({
      zh: '东京都 武藏野市 中町一丁目',
      ja: '東京都 武蔵野市 中町一丁目',
      en: 'Nakacho 1-chome, Musashino, Tokyo',
    })
  })

  it('zh 的「东京都/東京都」并列取 / 前一段', () => {
    expect(parseGeocodeAddresses(MUSASHINO).zh?.startsWith('东京都 ')).toBe(true)
  })

  it('跳过邮编与国家', () => {
    const all = Object.values(parseGeocodeAddresses(MUSASHINO)).join('|')
    expect(all).not.toContain('180-0006')
    expect(all).not.toContain('日本')
    expect(all).not.toContain('Japan')
  })

  it('缺町丁目一级时只拼剩下的两级', () => {
    const payload = {
      features: [
        {
          context: [
            { id: 'place.1', text_zh: '富士河口湖町', text_en: 'Fujikawaguchiko', text_ja: '富士河口湖町' },
            { id: 'region.2', text_zh: '山梨县', text_en: 'Yamanashi', text_ja: '山梨県' },
          ],
        },
      ],
    }
    expect(parseGeocodeAddresses(payload)).toEqual({
      zh: '山梨县 富士河口湖町',
      ja: '山梨県 富士河口湖町',
      en: 'Fujikawaguchiko, Yamanashi',
    })
  })

  it('某一级缺该语言字段时退回无后缀的 text', () => {
    const payload = {
      features: [{ context: [{ id: 'region.1', text: '沖縄県' }] }],
    }
    expect(parseGeocodeAddresses(payload)).toEqual({ zh: '沖縄県', en: '沖縄県', ja: '沖縄県' })
  })

  it('同一层级出现多条时取第一条', () => {
    const payload = {
      features: [
        {
          context: [
            { id: 'municipality.1', text_zh: '甲' },
            { id: 'place.2', text_zh: '乙' },
          ],
        },
      ],
    }
    expect(parseGeocodeAddresses(payload).zh).toBe('甲')
  })

  it('空响应 / 无 context / 非对象都返回三个 null', () => {
    const empty = { zh: null, en: null, ja: null }
    expect(parseGeocodeAddresses({ features: [] })).toEqual(empty)
    expect(parseGeocodeAddresses({ features: [{}] })).toEqual(empty)
    expect(parseGeocodeAddresses(null)).toEqual(empty)
    expect(parseGeocodeAddresses('nope')).toEqual(empty)
  })
})
