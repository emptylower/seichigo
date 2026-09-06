import { describe, expect, it } from 'vitest'
import en from '@/lib/i18n/locales/en.json'
import ja from '@/lib/i18n/locales/ja.json'
import zh from '@/lib/i18n/locales/zh.json'
import { flatten } from './homeKeys.test'

type Dict = Record<string, unknown>

function at(dict: Dict, prefix: string): unknown {
  let current: unknown = dict
  for (const key of prefix.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Dict)[key]
  }
  return current
}

const LOCALES = [
  ['zh', zh as Dict],
  ['en', en as Dict],
  ['ja', ja as Dict],
] as const

/**
 * 订阅分档文案：`billing.*`（用量表 / 档位提示，components/billing 用）与
 * `pages.pricing.*`（套餐页）。`t()` 缺 key 时把 key 名原样渲染到页面上，
 * 所以三语必须逐叶子对齐。
 */
describe.each(['billing', 'pages.pricing'] as const)('%s i18n keys', (prefix) => {
  const keysOf = (dict: Dict) => Object.keys(flatten(at(dict, prefix))).sort()
  const zhKeys = keysOf(zh as Dict)

  it('中文里确实有这一段', () => {
    expect(zhKeys.length).toBeGreaterThan(5)
  })

  it.each(LOCALES)('%s 的键集合与 zh 一致', (_locale, dict) => {
    expect(keysOf(dict)).toEqual(zhKeys)
  })

  it.each(LOCALES)('%s 没有空值', (_locale, dict) => {
    for (const [key, value] of Object.entries(flatten(at(dict, prefix)))) {
      expect(typeof value, key).toBe('string')
      expect(value.trim(), key).not.toBe('')
    }
  })

  it.each(LOCALES)('%s 不出现 credit / token / 成本 / 调用次数', (_locale, dict) => {
    for (const [key, value] of Object.entries(flatten(at(dict, prefix)))) {
      expect(/credit|token|成本|调用次数/i.test(value), `${key} = ${value}`).toBe(false)
    }
  })

  it('en 里没有残留中文/日文', () => {
    for (const [key, value] of Object.entries(flatten(at(en as Dict, prefix)))) {
      expect(/[一-鿿ぁ-ヿ]/.test(value), `en.${key} = ${value}`).toBe(false)
    }
  })

  it('带占位符的模板三语都保留同一批占位符', () => {
    const placeholders = (value: string) => (value.match(/\{[a-zA-Z]+\}/g) ?? []).sort()
    const zhFlat = flatten(at(zh as Dict, prefix))
    for (const [locale, dict] of LOCALES) {
      const flat = flatten(at(dict, prefix))
      for (const [key, value] of Object.entries(zhFlat)) {
        expect(placeholders(flat[key] ?? ''), `${locale}.${key}`).toEqual(placeholders(value))
      }
    }
  })
})

describe('billing 档位名覆盖 UsageView 的三个 tier', () => {
  it.each(LOCALES)('%s', (_locale, dict) => {
    const tiers = flatten(at(dict, 'billing.tier'))
    expect(Object.keys(tiers).sort()).toEqual(['free', 'pro', 'standard'])
  })
})
