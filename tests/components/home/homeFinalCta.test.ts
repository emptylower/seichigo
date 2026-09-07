import { describe, expect, it } from 'vitest'
// 注：纯函数模块按 part1 先例命名 homeFinalCtaUtils.ts——macOS 大小写不敏感 FS 上
// `homeFinalCta.ts` 会与 `HomeFinalCta.tsx` 撞同一个模块解析路径（同 homeMapDatabaseUtils 的规避）。
import { finalCtaStatsLine, finalCtaTitleSegments, roundedPoints } from '@/components/home/homeFinalCtaUtils'
import { statsFixture } from './fixtures'

describe('roundedPoints（与首屏同口径，但不 import HomeHero）', () => {
  it('zh/ja 取整到万位，en 取整到千位加 k', () => {
    expect(roundedPoints(128456, 'zh')).toBe('13 万')
    expect(roundedPoints(128456, 'ja')).toBe('13万')
    expect(roundedPoints(128456, 'en')).toBe('128k')
    expect(roundedPoints(50597, 'zh')).toBe('5 万')
    expect(roundedPoints(50597, 'ja')).toBe('5万')
    expect(roundedPoints(50597, 'en')).toBe('51k')
  })

  it('0 / undefined / 负数返回空串', () => {
    expect(roundedPoints(0, 'zh')).toBe('')
    expect(roundedPoints(undefined, 'zh')).toBe('')
    expect(roundedPoints(-5, 'en')).toBe('')
  })
})

describe('finalCtaTitleSegments', () => {
  it('按 {a1}/{a2}/{a3} 拆成文本与 accent 片段，保持出现顺序', () => {
    expect(finalCtaTitleSegments('说出{a1}和{a2}，{a3}帮你排好', ['作品', '假期', '规划师'])).toEqual([
      { kind: 'text', text: '说出' },
      { kind: 'accent', text: '作品' },
      { kind: 'text', text: '和' },
      { kind: 'accent', text: '假期' },
      { kind: 'text', text: '，' },
      { kind: 'accent', text: '规划师' },
      { kind: 'text', text: '帮你排好' },
    ])
  })

  it('accent 在句尾也正确收尾；没有占位时整段是 text', () => {
    expect(finalCtaTitleSegments('written by {a1}', ['fellow travelers', '', ''])).toEqual([
      { kind: 'text', text: 'written by ' },
      { kind: 'accent', text: 'fellow travelers' },
    ])
    expect(finalCtaTitleSegments('没有占位', ['a', 'b', 'c'])).toEqual([{ kind: 'text', text: '没有占位' }])
  })
})

describe('finalCtaStatsLine', () => {
  it('有 stats：points 按口径取整、works 用真实值千分位（zh）', () => {
    expect(finalCtaStatsLine('zh', statsFixture)).toBe('全球 13 万+ 巡礼点位 · 1,234+ 动漫作品 · 你的专属行程')
  })

  it('en/ja 用各自模板与取整口径，works 同样千分位', () => {
    expect(finalCtaStatsLine('en', statsFixture)).toBe(
      '128k+ pilgrimage spots worldwide · 1,234+ anime series · your own itinerary',
    )
    expect(finalCtaStatsLine('ja', { points: 50597, works: 100, cities: 5, posts: 3 })).toBe(
      '世界 5万+ の巡礼スポット · 100+ のアニメ作品 · あなただけの行程',
    )
  })

  it('stats 缺失或 points 无效时只显示「你的专属行程」小节', () => {
    expect(finalCtaStatsLine('zh', undefined)).toBe('你的专属行程')
    expect(finalCtaStatsLine('zh', { points: 0, works: 0, cities: 0, posts: 0 })).toBe('你的专属行程')
  })
})
