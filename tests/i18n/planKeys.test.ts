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
 * 计划页（`/plan/[id]`）文案子树：三语叶子键必须完全一致且值非空。
 * `t()` 缺 key 时把 key 名原样渲染到页面上，所以少一个键就是线上一处乱码文案。
 */
describe('pages.plan i18n keys', () => {
  const keysOf = (dict: Dict) => Object.keys(flatten(at(dict, 'pages.plan'))).sort()
  const zhKeys = keysOf(zh as Dict)

  it('中文里确实有这一段（不是整段缺失后空对空地比过）', () => {
    expect(zhKeys.length).toBeGreaterThan(80)
  })

  it.each(LOCALES)('%s 的键集合与 zh 一致', (_locale, dict) => {
    expect(keysOf(dict)).toEqual(zhKeys)
  })

  it.each(LOCALES)('%s 没有空值', (_locale, dict) => {
    for (const [key, value] of Object.entries(flatten(at(dict, 'pages.plan')))) {
      expect(typeof value, key).toBe('string')
      expect(value.trim(), key).not.toBe('')
    }
  })

  it('每个分区都在位（组件按分区取文案）', () => {
    const plan = at(zh as Dict, 'pages.plan') as Dict
    for (const section of [
      'common',
      'sidebar',
      'composer',
      'chat',
      'thinking',
      'ask',
      'day',
      'transit',
      'map',
      'thumbnail',
      'errors',
    ]) {
      expect(plan, section).toHaveProperty(section)
    }
  })

  it('带占位符的模板三语都保留同一批占位符', () => {
    const placeholders = (value: string) => (value.match(/\{[a-zA-Z]+\}/g) ?? []).sort()
    const zhFlat = flatten(at(zh as Dict, 'pages.plan'))
    for (const [locale, dict] of LOCALES) {
      const flat = flatten(at(dict, 'pages.plan'))
      for (const [key, value] of Object.entries(zhFlat)) {
        expect(placeholders(flat[key] ?? ''), `${locale}.${key}`).toEqual(placeholders(value))
      }
    }
  })

  /** 日文服务专名（Yahoo! 乗換案内）在英文文案里保留原名，是有意为之 */
  const CJK_ALLOWED_EN_KEYS = new Set(['transit.localHint'])

  it('en 的静态文案里没有残留中文/日文（专名除外）', () => {
    for (const [key, value] of Object.entries(flatten(at(en as Dict, 'pages.plan')))) {
      if (CJK_ALLOWED_EN_KEYS.has(key)) continue
      expect(/[一-鿿ぁ-ヿ]/.test(value), `en.${key} = ${value}`).toBe(false)
    }
  })
})
