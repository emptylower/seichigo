import { describe, expect, it } from 'vitest'
import { CARD_METRICS, buildAnimeMetaLine, escapeHtml, formatSceneTime } from '@/lib/share/cardHtml'
import { SHARE_CARD_SIZES } from '@/lib/share/types'

describe('formatSceneTime', () => {
  it('纯数字秒数格式化成 mm:ss / h:mm:ss', () => {
    expect(formatSceneTime('1194')).toBe('19:54')
    expect(formatSceneTime('65')).toBe('1:05')
    expect(formatSceneTime('3725')).toBe('1:02:05')
  })

  it('非纯数字原样返回', () => {
    expect(formatSceneTime('第3話 冒頭')).toBe('第3話 冒頭')
  })
})

describe('escapeHtml', () => {
  it('转义会破坏结构的五个字符', () => {
    expect(escapeHtml(`<img src="x" onerror='y'>&`)).toBe(
      '&lt;img src=&quot;x&quot; onerror=&#39;y&#39;&gt;&amp;',
    )
  })

  it('null / undefined 转成空串', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })
})

describe('buildAnimeMetaLine', () => {
  it('zh 用书名号、en 裸标题、ja 用双重角括号', () => {
    const base = { animeTitle: '你的名字。', episode: '1', scene: '1194' } as const
    expect(buildAnimeMetaLine({ ...base, locale: 'zh' })).toBe('《你的名字。》 · 第 1 集 · 19:54')
    expect(buildAnimeMetaLine({ ...base, locale: 'en' })).toBe('你的名字。 · EP 1 · 19:54')
    expect(buildAnimeMetaLine({ ...base, locale: 'ja' })).toBe('『你的名字。』 · 第1話 · 19:54')
  })

  it('缺段就少段，全缺返回空串', () => {
    expect(buildAnimeMetaLine({ locale: 'zh', animeTitle: '孤独摇滚', episode: null, scene: null })).toBe(
      '《孤独摇滚》',
    )
    expect(buildAnimeMetaLine({ locale: 'zh', animeTitle: '', episode: null, scene: null })).toBe('')
  })
})

describe('CARD_METRICS', () => {
  it('画布尺寸与 SHARE_CARD_SIZES 一致', () => {
    expect(CARD_METRICS.portrait.width).toBe(SHARE_CARD_SIZES.portrait.width)
    expect(CARD_METRICS.portrait.height).toBe(SHARE_CARD_SIZES.portrait.height)
    expect(CARD_METRICS.landscape.width).toBe(SHARE_CARD_SIZES.landscape.width)
    expect(CARD_METRICS.landscape.height).toBe(SHARE_CARD_SIZES.landscape.height)
  })

  it('沿用线上导航胶囊版的关键数值', () => {
    expect(CARD_METRICS.landscape.visual).toBe(640)
    expect(CARD_METRICS.landscape.columnLeft).toBe(32)
    expect(CARD_METRICS.landscape.outlineSize).toBe(100)
    expect(CARD_METRICS.landscape.qrSize).toBe(100)
    expect(CARD_METRICS.portrait.visual).toBe(640)
    expect(CARD_METRICS.portrait.padding).toBe(64)
    expect(CARD_METRICS.portrait.outlineSize).toBe(180)
    expect(CARD_METRICS.portrait.nameSize).toBe(60)
    expect(CARD_METRICS.portrait.nameLines).toBe(2)
    expect(CARD_METRICS.landscape.nameLines).toBe(1)
  })
})
