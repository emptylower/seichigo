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
 * 点位分享面板文案：`share.*`。t() 缺 key 会把 key 名原样渲染到按钮上，
 * 所以三语必须逐叶子对齐。
 */
describe('share i18n keys', () => {
  const keysOf = (dict: Dict) => Object.keys(flatten(at(dict, 'share'))).sort()
  const zhKeys = keysOf(zh as Dict)

  it('中文里确实有这一段', () => {
    expect(zhKeys.length).toBeGreaterThan(15)
  })

  it.each(LOCALES)('%s 的键集合与 zh 一致', (_locale, dict) => {
    expect(keysOf(dict)).toEqual(zhKeys)
  })

  it.each(LOCALES)('%s 没有空值', (_locale, dict) => {
    for (const [key, value] of Object.entries(flatten(at(dict, 'share')))) {
      expect(typeof value, key).toBe('string')
      expect(value.trim(), key).not.toBe('')
    }
  })

  it.each(LOCALES)('%s 的文案模板四个占位符齐全', (_locale, dict) => {
    const template = at(dict, 'share.captionTemplate') as string
    for (const token of ['{anime}', '{point}', '{address}', '{url}']) {
      expect(template.includes(token), `${token} in ${template}`).toBe(true)
    }
    expect(template.includes('{city}'), `v1 的 {city} 应已下线：${template}`).toBe(false)
  })

  // 2026-09-08 Track B 评审修复新增的键，逐个登记防漏翻
  const REVIEW_FIX_KEYS = ['retry', 'toastPhotoTooLarge', 'toastPhotoUnsupported', 'redditTitle']
  // 2026-09-08 分享 v2 目的地驱动面板新增的键
  const V2_KEYS = [
    'shareTo',
    'more',
    'toastImageCopiedPasteInPost',
    'toastImageDownloadedDragIntoPost',
    'toastSavedAndCopiedOpenApp',
  ]
  // 2026-09-08 Track B 低危修复：文案编辑器的收起 / 恢复默认
  const CAPTION_EDITOR_KEYS = ['collapseCaption', 'resetCaption']
  // 2026-09-08 分享卡片 v2.1 导航胶囊：胶囊标题 / 副标题 / 页脚标语
  const V2_1_KEYS = ['cardQrTitle', 'cardQrSub', 'cardTagline']
  // 2026-09-08 服务端渲染改造：未登录时「添加实拍」的需登录态
  const OG_SERVER_RENDER_KEYS = ['addPhotoLoginRequired']

  it.each(LOCALES)('%s 含有评审修复新增的键', (_locale, dict) => {
    for (const key of [
      ...REVIEW_FIX_KEYS,
      ...V2_KEYS,
      ...CAPTION_EDITOR_KEYS,
      ...V2_1_KEYS,
      ...OG_SERVER_RENDER_KEYS,
    ]) {
      expect(at(dict, `share.${key}`), `share.${key}`).toBeTruthy()
    }
  })

  it.each(LOCALES)('%s 的 toastSavedAndCopiedOpenApp 带 {app} 占位', (_locale, dict) => {
    expect(String(at(dict, 'share.toastSavedAndCopiedOpenApp'))).toContain('{app}')
  })

  it.each(LOCALES)('%s 已删除 v1 的 systemShare / toastPasteInApp', (_locale, dict) => {
    expect(at(dict, 'share.systemShare')).toBeUndefined()
    expect(at(dict, 'share.toastPasteInApp')).toBeUndefined()
  })
})
