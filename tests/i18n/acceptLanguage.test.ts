import { describe, it, expect } from 'vitest'
import { pickLocaleFromAcceptLanguage } from '../../lib/i18n/acceptLanguage'

describe('pickLocaleFromAcceptLanguage', () => {
  describe('chinese primary tags', () => {
    it.each(['zh', 'zh-CN', 'zh-TW', 'zh-HK', 'zh-SG', 'zh-MO', 'zh-Hans', 'zh-Hant'])(
      'maps %s to zh',
      (header) => {
        expect(pickLocaleFromAcceptLanguage(header)).toBe('zh')
      }
    )

    it('keeps zh as highest priority when en has lower q', () => {
      expect(pickLocaleFromAcceptLanguage('zh-TW,en;q=0.8')).toBe('zh')
    })

    it('is case insensitive', () => {
      expect(pickLocaleFromAcceptLanguage('ZH-CN')).toBe('zh')
    })
  })

  describe('japanese primary tag', () => {
    it.each(['ja', 'ja-JP'])('maps %s to ja', (header) => {
      expect(pickLocaleFromAcceptLanguage(header)).toBe('ja')
    })
  })

  describe('other languages fall back to en', () => {
    it.each(['en', 'en-US', 'en-GB', 'ko-KR', 'fr', 'fr-FR', 'de-DE', 'ru', 'es-ES', 'pt-BR'])(
      'maps %s to en',
      (header) => {
        expect(pickLocaleFromAcceptLanguage(header)).toBe('en')
      }
    )
  })

  describe('q-value ordering', () => {
    it('picks the higher q language regardless of order', () => {
      expect(pickLocaleFromAcceptLanguage('en;q=0.5, ja;q=0.9')).toBe('ja')
    })

    it('picks zh when zh has higher q than ja', () => {
      expect(pickLocaleFromAcceptLanguage('ja;q=0.8, zh-CN;q=0.9')).toBe('zh')
    })

    it('keeps first-listed language on equal q values', () => {
      expect(pickLocaleFromAcceptLanguage('ja, zh-CN')).toBe('ja')
      expect(pickLocaleFromAcceptLanguage('zh-CN, ja')).toBe('zh')
    })

    it('treats missing q as 1', () => {
      expect(pickLocaleFromAcceptLanguage('ja;q=0.9, en')).toBe('en')
    })

    it('ignores languages with q=0', () => {
      expect(pickLocaleFromAcceptLanguage('ja;q=0, en-US')).toBe('en')
    })
  })

  describe('unparseable input returns null', () => {
    it.each([null, undefined, '', '   ', ',', ';', '*'] as const)(
      'returns null for %j',
      (header) => {
        expect(pickLocaleFromAcceptLanguage(header)).toBeNull()
      }
    )

    it('returns null when wildcard is the top entry', () => {
      expect(pickLocaleFromAcceptLanguage('*;q=1, en;q=0.5')).toBeNull()
    })
  })
})
