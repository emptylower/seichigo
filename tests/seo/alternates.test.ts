import { describe, expect, it, vi, afterEach } from 'vitest'
import { buildHreflangAlternates } from '@/lib/seo/alternates'

const ENCODED_SLUG_PATH =
  '/ja/posts/%E4%BD%A0%E7%9A%84%E5%90%8D%E5%AD%97-your-name-seichigo-tokyo-shinjuku'
const UNENCODED_SLUG_PATH = '/ja/posts/你的名字-your-name-seichigo-tokyo-shinjuku'
const ENCODED_ZH_PATH = '/posts/%E4%BD%A0%E7%9A%84%E5%90%8D%E5%AD%97-your-name-seichigo-tokyo-shinjuku'
const UNENCODED_ZH_PATH = '/posts/你的名字-your-name-seichigo-tokyo-shinjuku'
const ENCODED_EN_PATH = '/en/posts/%E4%BD%A0%E7%9A%84%E5%90%8D%E5%AD%97-your-name-seichigo-tokyo-shinjuku'
const UNENCODED_EN_PATH = '/en/posts/你的名字-your-name-seichigo-tokyo-shinjuku'

describe('buildHreflangAlternates percent-encoding', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('keeps already-encoded CJK paths single-encoded (no %25 double encoding)', () => {
    vi.stubEnv('SITE_URL', 'https://seichigo.com')

    const result = buildHreflangAlternates({
      canonicalPath: ENCODED_SLUG_PATH,
      zhPath: ENCODED_ZH_PATH,
      enPath: ENCODED_EN_PATH,
      jaPath: ENCODED_SLUG_PATH,
    })

    expect(result.canonical).toBe(ENCODED_SLUG_PATH)
    expect(result.languages.ja).toBe(`https://seichigo.com${ENCODED_SLUG_PATH}`)
    expect(result.languages.zh).toBe(`https://seichigo.com${ENCODED_ZH_PATH}`)
    expect(result.languages.en).toBe(`https://seichigo.com${ENCODED_EN_PATH}`)
    expect(result.languages['x-default']).toBe(`https://seichigo.com${ENCODED_ZH_PATH}`)
    expect(result.canonical).not.toContain('%25')
    for (const url of Object.values(result.languages)) {
      expect(url).not.toContain('%25')
    }
  })

  it('produces identical output for unencoded CJK input', () => {
    vi.stubEnv('SITE_URL', 'https://seichigo.com')

    const result = buildHreflangAlternates({
      canonicalPath: UNENCODED_SLUG_PATH,
      zhPath: UNENCODED_ZH_PATH,
      enPath: UNENCODED_EN_PATH,
      jaPath: UNENCODED_SLUG_PATH,
    })

    expect(result.canonical).toBe(ENCODED_SLUG_PATH)
    expect(result.languages.ja).toBe(`https://seichigo.com${ENCODED_SLUG_PATH}`)
    expect(result.languages.zh).toBe(`https://seichigo.com${ENCODED_ZH_PATH}`)
    expect(result.languages.en).toBe(`https://seichigo.com${ENCODED_EN_PATH}`)
  })

  it('leaves pure ASCII paths unchanged', () => {
    vi.stubEnv('SITE_URL', 'https://seichigo.com')

    const result = buildHreflangAlternates({
      canonicalPath: '/ja/posts/suga-shrine-shinjuku',
      zhPath: '/posts/suga-shrine-shinjuku',
      enPath: '/en/posts/suga-shrine-shinjuku',
      jaPath: '/ja/posts/suga-shrine-shinjuku',
    })

    expect(result.canonical).toBe('/ja/posts/suga-shrine-shinjuku')
    expect(result.languages.ja).toBe('https://seichigo.com/ja/posts/suga-shrine-shinjuku')
    expect(result.languages.zh).toBe('https://seichigo.com/posts/suga-shrine-shinjuku')
    expect(result.languages.en).toBe('https://seichigo.com/en/posts/suga-shrine-shinjuku')
  })
})
