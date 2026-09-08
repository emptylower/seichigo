import { describe, expect, it } from 'vitest'
import {
  JAPAN_BBOX,
  SHARE_CARD_SIZES,
  SHARE_CHANNELS,
  SHARE_CHANNEL_UTM_MEDIUM,
  isInJapan,
  isShareChannel,
  isShareCardLayout,
  shareLinkPath,
} from '@/lib/share/types'

describe('share 契约常量', () => {
  it('两种版式尺寸与设计一致', () => {
    expect(SHARE_CARD_SIZES.portrait).toEqual({ width: 1080, height: 1440 })
    expect(SHARE_CARD_SIZES.landscape).toEqual({ width: 1200, height: 630 })
  })

  it('八个渠道都有 utm_medium 映射', () => {
    expect(SHARE_CHANNELS).toEqual(['x', 'rd', 'ln', 'xhs', 'wx', 'sys', 'copy', 'save'])
    expect(SHARE_CHANNEL_UTM_MEDIUM).toEqual({
      x: 'twitter',
      rd: 'reddit',
      ln: 'line',
      xhs: 'xiaohongshu',
      wx: 'wechat',
      sys: 'native',
      copy: 'copy',
      save: 'image',
    })
  })

  it('守卫函数只认合法值', () => {
    expect(isShareChannel('x')).toBe(true)
    expect(isShareChannel('weibo')).toBe(false)
    expect(isShareCardLayout('portrait')).toBe(true)
    expect(isShareCardLayout('square')).toBe(false)
  })

  it('短链路径按需要带渠道参数', () => {
    expect(shareLinkPath('AbC12xYz')).toBe('/s/AbC12xYz')
    expect(shareLinkPath('AbC12xYz', 'xhs')).toBe('/s/AbC12xYz?c=xhs')
  })
})

describe('isInJapan', () => {
  it('JAPAN_BBOX 从轮廓 JSON 派生，形如 [minLon, minLat, maxLon, maxLat]', () => {
    expect(JAPAN_BBOX).toEqual([123.68, 24.266, 145.833, 45.51])
  })

  it('东京、对马、五岛福江岛都在轮廓内', () => {
    expect(isInJapan(35.68, 139.7)).toBe(true)
    expect(isInJapan(34.4, 129.3)).toBe(true)
    // 《ばらかもん》全部点位所在的福江岛，两矩形并集曾把它判成海外
    expect(isInJapan(32.7, 128.84)).toBe(true)
  })

  it('釜山、海参崴、首尔、台北、上海都在轮廓外', () => {
    expect(isInJapan(35.18, 129.08)).toBe(false)
    expect(isInJapan(43.12, 131.9)).toBe(false)
    expect(isInJapan(37.5665, 126.978)).toBe(false)
    expect(isInJapan(25.033, 121.5654)).toBe(false)
    expect(isInJapan(31.2304, 121.4737)).toBe(false)
  })

  it('与那国岛在轮廓外（轮廓数据本身不含与那国岛）', () => {
    expect(isInJapan(24.45, 122.93)).toBe(false)
  })

  it('檀香山在轮廓外', () => {
    expect(isInJapan(21.3069, -157.8583)).toBe(false)
  })
})
