import { describe, expect, it } from 'vitest'
import { parseStartLocale } from '@/app/(plan-start)/plan/start/locale'
import { firstQueryValue } from '@/components/plan/planStartQuery'

describe('parseStartLocale（旧 ?locale= 协议：认不出返回 null，中文 page 留在中文）', () => {
  it('returns en for a valid en param', () => {
    expect(parseStartLocale('en')).toBe('en')
  })

  it('returns ja for a valid ja param', () => {
    expect(parseStartLocale('ja')).toBe('ja')
  })

  it('takes the first value of an array param', () => {
    expect(parseStartLocale(['ja', 'en'])).toBe('ja')
  })

  it('returns null when the param is missing', () => {
    expect(parseStartLocale(undefined)).toBeNull()
  })

  it('returns null for an unsupported language', () => {
    expect(parseStartLocale('xx')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(parseStartLocale('')).toBeNull()
  })

  it('returns zh for zh（由中文 page 判定后跳过重定向）', () => {
    expect(parseStartLocale('zh')).toBe('zh')
  })
})

describe('firstQueryValue（重复参数取第一项）', () => {
  it('string 原样返回', () => {
    expect(firstQueryValue('東京 5 日間')).toBe('東京 5 日間')
  })

  it('数组取第一项', () => {
    expect(firstQueryValue(['a', 'b'])).toBe('a')
  })

  it('空数组与缺失返回空字符串', () => {
    expect(firstQueryValue([])).toBe('')
    expect(firstQueryValue(undefined)).toBe('')
  })
})
