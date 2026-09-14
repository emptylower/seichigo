import { describe, expect, it } from 'vitest'
import { LEGACY_POST_SLUGS, resolveLegacyPostSlug } from '@/lib/posts/legacySlugs'
import { isValidArticleSlug } from '@/lib/article/slug'

describe('resolveLegacyPostSlug', () => {
  it('maps all three legacy slugs to their new targets', () => {
    expect(Object.keys(LEGACY_POST_SLUGS)).toHaveLength(3)
    expect(resolveLegacyPostSlug('你的名字-your-name-seichigo-tokyo-shinjuku')).toBe(
      'your-name-pilgrimage-part1-tokyo-shinjuku'
    )
    expect(resolveLegacyPostSlug('你的名字-your-name-tokyo-minato-ward')).toBe(
      'your-name-pilgrimage-part2-tokyo-minato'
    )
    expect(resolveLegacyPostSlug('你的名字-your-name-tokyo-from-hida-to-suwa')).toBe(
      'your-name-pilgrimage-part3-hida-to-suwa'
    )
  })

  it('resolves percent-encoded legacy slugs', () => {
    const encoded = encodeURIComponent('你的名字-your-name-seichigo-tokyo-shinjuku')
    expect(resolveLegacyPostSlug(encoded)).toBe('your-name-pilgrimage-part1-tokyo-shinjuku')
  })

  it('returns null for non-legacy slugs', () => {
    expect(resolveLegacyPostSlug('your-name-pilgrimage-part1-tokyo-shinjuku')).toBe(null)
    expect(resolveLegacyPostSlug('suga-shrine-shinjuku')).toBe(null)
    expect(resolveLegacyPostSlug('你的名字-fixture-tokyo')).toBe(null)
    expect(resolveLegacyPostSlug('')).toBe(null)
  })

  it('all new slugs pass isValidArticleSlug', () => {
    for (const newSlug of Object.values(LEGACY_POST_SLUGS)) {
      expect(isValidArticleSlug(newSlug)).toBe(true)
    }
  })
})
