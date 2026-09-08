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
  it('bbox 是 [minLon, minLat, maxLon, maxLat]', () => {
    expect(JAPAN_BBOX).toEqual([123.6, 24.2, 145.9, 45.6])
  })

  it('东京在框内', () => {
    expect(isInJapan(35.68, 139.7)).toBe(true)
  })

  it('bbox 四角都算在框内（闭区间）', () => {
    expect(isInJapan(24.2, 123.6)).toBe(true)
    expect(isInJapan(45.6, 145.9)).toBe(true)
  })

  it('首尔与檀香山在框外', () => {
    expect(isInJapan(37.5665, 126.978)).toBe(false)
    expect(isInJapan(21.3069, -157.8583)).toBe(false)
  })
})
