import { describe, expect, it } from 'vitest'
import { getLegalDocument } from '@/lib/legal/content'

const LOCALES = ['zh', 'en', 'ja'] as const

const HEADING = {
  zh: /付费订阅/,
  en: /Paid Subscriptions/i,
  ja: /有料サブスクリプション/,
} as const

describe('terms paid subscription clause', () => {
  it.each(LOCALES)('%s 用户协议里有“付费订阅”一节', (locale) => {
    const doc = getLegalDocument('terms', locale)
    const section = doc.sections.find((s) => HEADING[locale].test(s.heading))
    expect(section, `${locale} 缺少付费订阅一节`).toBeDefined()
    expect((section?.bullets ?? []).length).toBeGreaterThanOrEqual(4)
  })

  it.each(LOCALES)('%s 覆盖自动续费、取消生效时点、不退款与故障退款窗口、调价通知', (locale) => {
    const section = getLegalDocument('terms', locale).sections.find((s) => HEADING[locale].test(s.heading))
    const text = (section?.bullets ?? []).join('\n')
    expect(text).toMatch(/按月自动续费|renews automatically|毎月自動更新/i)
    expect(text).toMatch(/当前计费周期结束|end of the current billing period|請求期間の終了時/i)
    expect(text).toMatch(/不予退款|non-refundable|返金されません/i)
    expect(text).toMatch(/7\s*(天|days|日)/i)
    expect(text).toMatch(/contact@seichigo\.com/)
    expect(text).toMatch(/提前通知|advance notice|事前に通知/i)
  })

  it.each(LOCALES)('%s 付费订阅排在免责条款之前', (locale) => {
    const sections = getLegalDocument('terms', locale).sections
    const paid = sections.findIndex((s) => HEADING[locale].test(s.heading))
    const disclaimer = sections.findIndex((s) => /责任限制|Disclaimer|免責/.test(s.heading))
    expect(paid).toBeGreaterThan(0)
    expect(paid).toBeLessThan(disclaimer)
  })

  it.each(LOCALES)('%s 章节编号仍然连续', (locale) => {
    const doc = getLegalDocument('terms', locale)
    const numbers = doc.sections.map((s) => Number(s.heading.match(/^(\d+)\./)?.[1]))
    expect(numbers).toEqual(numbers.map((_, index) => index + 1))
  })
})
