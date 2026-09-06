import { describe, expect, it } from 'vitest'
import { toIntlLocale } from '@/lib/i18n/intlLocale'

describe('toIntlLocale', () => {
  it('maps zh to zh-CN', () => {
    expect(toIntlLocale('zh')).toBe('zh-CN')
  })

  it('maps en to en-US', () => {
    expect(toIntlLocale('en')).toBe('en-US')
  })

  it('maps ja to ja-JP', () => {
    expect(toIntlLocale('ja')).toBe('ja-JP')
  })
})
