import { describe, expect, it } from 'vitest'
import en from '@/lib/i18n/locales/en.json'
import ja from '@/lib/i18n/locales/ja.json'
import zh from '@/lib/i18n/locales/zh.json'

type Dict = Record<string, unknown>

function at(dict: Dict, prefix: string): unknown {
  let current: unknown = dict
  for (const key of prefix.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Dict)[key]
  }
  return current
}

/**
 * 低-11：递归展平成 `a.b.c` → 值。以前只比一层，嵌套子树里少一个 key 是看不见的；
 * `t()` 缺 key 时会把 key 名原样渲染到页面上，所以必须逐叶子比。
 */
export function flatten(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, child] of Object.entries(value as Dict)) {
    Object.assign(out, flatten(child, prefix ? `${prefix}.${key}` : key))
  }
  return out
}

/**
 * 第十二轮落地页链路的文案前缀：新首页、规划师起始页、登录弹窗。
 * 三份 locale 必须键集合一致且值非空。
 */
const PREFIXES = ['pages.home.v2', 'pages.planStart', 'pages.posts', 'auth.modal'] as const

const LOCALES = [
  ['zh', zh as Dict],
  ['en', en as Dict],
  ['ja', ja as Dict],
] as const

describe.each(PREFIXES)('%s i18n keys', (prefix) => {
  const keysOf = (dict: Dict) => Object.keys(flatten(at(dict, prefix))).sort()
  const zhKeys = keysOf(zh as Dict)

  it('中文里确实有这一段（不是整段缺失后空对空地比过）', () => {
    expect(zhKeys.length).toBeGreaterThan(0)
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
})

describe('新首页关键 key 在位', () => {
  const homeV2 = flatten(at(zh as Dict, 'pages.home.v2'))

  it.each([
    'heroTitle',
    'heroTitleAccent',
    'heroSlogan',
    'heroDemoSummary',
    'heroDemoWalkTotal',
    'composerPlaceholder',
    'planTitle',
    'mapDbTitle',
    'heroScrollHint',
  ])('%s', (key) => {
    expect(homeV2).toHaveProperty(key)
  })

  it('heroTitle 三语都是带 {accent} 的两段式模板（第十四轮标题高亮）', () => {
    for (const [, dict] of LOCALES) {
      const home = flatten(at(dict, 'pages.home.v2'))
      expect(home['heroTitle']).toContain('{accent}')
      expect(home['heroTitleAccent']).not.toContain('{')
    }
  })

  it('手机演示汇总行是带占位的整句模板', () => {
    for (const [, dict] of LOCALES) {
      const home = flatten(at(dict, 'pages.home.v2'))
      expect(home['heroDemoSummary']).toContain('{count}')
      expect(home['heroDemoSummary']).toContain('{day}')
      expect(home['heroDemoWalkTotal']).toContain('{minutes}')
    }
  })

  it('地图数据库副标题是带 {works} 占位的整句模板（不再硬拼数字，不含城市数）', () => {
    for (const [, dict] of LOCALES) {
      const subtitle = flatten(at(dict, 'pages.home.v2'))['mapDbSubtitle']!
      expect(subtitle).toContain('{works}')
      expect(subtitle).not.toContain('{cities}')
    }
  })

  it('第三屏标题是带 {accent} 的模板（与 heroTitle 同做法），accent 本身不含占位', () => {
    for (const [, dict] of LOCALES) {
      const home = flatten(at(dict, 'pages.home.v2'))
      expect(home['planTitle']).toContain('{accent}')
      expect(home['planTitleAccent']).not.toContain('{')
    }
  })
})

describe('flatten', () => {
  it('递归到叶子，忽略数组与非字符串', () => {
    expect(flatten({ a: { b: 'x', c: { d: 'y' } }, e: ['z'], f: 1 })).toEqual({ 'a.b': 'x', 'a.c.d': 'y' })
  })
})
