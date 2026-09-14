import { describe, expect, it } from 'vitest'
import { planStartHref } from '@/components/home/planStartHref'

describe('planStartHref（首页直接导航：本地化路径 + draft，不再输出 locale 参数）', () => {
  it('无草稿：干净的目标语言路径', () => {
    expect(planStartHref('zh')).toBe('/plan/start')
    expect(planStartHref('en')).toBe('/en/plan/start')
    expect(planStartHref('ja')).toBe('/ja/plan/start')
  })

  it('有草稿：加 ?draft=（encodeURIComponent），不加 locale', () => {
    expect(planStartHref('zh', '镰仓两天')).toBe(`/plan/start?draft=${encodeURIComponent('镰仓两天')}`)
    expect(planStartHref('en', 'Kamakura weekend')).toBe('/en/plan/start?draft=Kamakura%20weekend')
    expect(planStartHref('ja', '東京 5 日間')).toBe(`/ja/plan/start?draft=${encodeURIComponent('東京 5 日間')}`)
  })

  it('特殊字符（&、空格、日文）全部正确编码且不产生多余参数', () => {
    const draft = '東京 & 京都 5 日間'
    const href = planStartHref('ja', draft)
    expect(href).toBe(`/ja/plan/start?draft=${encodeURIComponent(draft)}`)
    expect(href).not.toContain('locale=')
    expect(href.match(/\?draft=/g)).toHaveLength(1)
  })

  it('空字符串草稿按无草稿处理', () => {
    expect(planStartHref('en', '')).toBe('/en/plan/start')
  })
})
