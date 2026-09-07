import { describe, it, expect, afterEach } from 'vitest'
import { vi } from 'vitest'
import { INTENT_SOURCES, isCheckoutEnabled, normalizeIntentSource } from '@/lib/billing/checkoutGate'

/** F2：结账开关解析与意向 source 归一化 */

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isCheckoutEnabled', () => {
  it('BILLING_CHECKOUT_ENABLED === "1" 才开启', () => {
    vi.stubEnv('BILLING_CHECKOUT_ENABLED', '1')
    expect(isCheckoutEnabled()).toBe(true)
  })

  it('其它值 / 未设都关闭', () => {
    for (const value of ['0', 'true', 'yes', '']) {
      vi.stubEnv('BILLING_CHECKOUT_ENABLED', value)
      expect(isCheckoutEnabled()).toBe(false)
    }
    delete process.env.BILLING_CHECKOUT_ENABLED
    expect(isCheckoutEnabled()).toBe(false)
  })

  it('可注入 env 对象（不读全局 process.env）', () => {
    expect(isCheckoutEnabled({ BILLING_CHECKOUT_ENABLED: '1' })).toBe(true)
    expect(isCheckoutEnabled({})).toBe(false)
  })
})

describe('normalizeIntentSource', () => {
  it('白名单原样返回', () => {
    expect(normalizeIntentSource('pricing')).toBe('pricing')
    expect(normalizeIntentSource('profile')).toBe('profile')
    expect(normalizeIntentSource('hint')).toBe('hint')
    expect(normalizeIntentSource('usage')).toBe('usage')
  })

  it('非法值 / 非字符串 / 缺省都归 unknown', () => {
    expect(normalizeIntentSource('banner')).toBe('unknown')
    expect(normalizeIntentSource('')).toBe('unknown')
    expect(normalizeIntentSource(42)).toBe('unknown')
    expect(normalizeIntentSource(null)).toBe('unknown')
    expect(normalizeIntentSource(undefined)).toBe('unknown')
    expect(normalizeIntentSource({ source: 'pricing' })).toBe('unknown')
  })

  it('INTENT_SOURCES 与白名单一致（unknown 为兜底项）', () => {
    expect(INTENT_SOURCES).toEqual(['pricing', 'profile', 'hint', 'usage', 'unknown'])
  })
})
