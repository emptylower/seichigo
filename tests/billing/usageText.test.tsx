import { describe, expect, it } from 'vitest'
import { formatPercent, formatResetDate, usageBarTone } from '@/components/billing/usageText'

describe('usageText', () => {
  it('formatPercent shows <1% for tiny positive values and integers otherwise', () => {
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(0.4)).toBe('<1%')
    expect(formatPercent(37)).toBe('37%')
    expect(formatPercent(100)).toBe('100%')
  })
  it('formatResetDate renders M月D日恢复', () => {
    expect(formatResetDate('2026-09-20T00:00:00.000Z')).toMatch(/^9 月 (19|20) 日恢复$/)
    expect(formatResetDate('not-a-date')).toBe('')
  })
  it('usageBarTone maps percent to a tone', () => {
    expect(usageBarTone(80)).toBe('ok')
    expect(usageBarTone(20)).toBe('low')
    expect(usageBarTone(0)).toBe('empty')
  })
})
