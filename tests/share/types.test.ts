import { describe, expect, it } from 'vitest'
import {
  SHARE_CARD_SIZES,
  SHARE_CHANNELS,
  SHARE_CHANNEL_UTM_MEDIUM,
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
