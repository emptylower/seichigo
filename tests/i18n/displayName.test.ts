import { describe, expect, it } from 'vitest'
import { getLocalizedDisplayName, normalizeDisplayNameKey } from '@/lib/i18n/displayName'

describe('getLocalizedDisplayName', () => {
  const record = {
    name: '中文作品名',
    name_zh: '中文作品名',
    name_en: 'English Title',
    name_ja: '日本語タイトル',
  }

  it('uses the matching translation for English and Japanese', () => {
    expect(getLocalizedDisplayName(record, 'en')).toBe('English Title')
    expect(getLocalizedDisplayName(record, 'ja')).toBe('日本語タイトル')
  })

  it('falls back to the Chinese source name when a translation is missing', () => {
    expect(getLocalizedDisplayName({ name_zh: '京都', name_en: null }, 'en')).toBe('京都')
    expect(getLocalizedDisplayName({ name: '作品原名', name_ja: '' }, 'ja')).toBe('作品原名')
  })

  it('normalizes lookup keys without changing the source identifier', () => {
    expect(normalizeDisplayNameKey('  Sound! Euphonium  ')).toBe('sound! euphonium')
    expect(normalizeDisplayNameKey('你的名字')).toBe('你的名字')
  })
})
