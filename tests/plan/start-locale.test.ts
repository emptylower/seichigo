import { describe, expect, it } from 'vitest'
import { parseStartLocale } from '@/app/(authed)/plan/start/locale'

describe('parseStartLocale（认不出返回 null，由页面回落 getLocale）', () => {
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
})
