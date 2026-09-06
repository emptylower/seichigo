import { describe, expect, it } from 'vitest'
import { resolveRequestLocale } from '@/lib/i18n/resolveRequestLocale'

describe('resolveRequestLocale', () => {
  it('prefers /en path prefix over cookie', () => {
    expect(
      resolveRequestLocale({
        pathname: '/en/anything',
        cookieHeader: 'NEXT_LOCALE=ja',
        acceptLanguage: null,
      })
    ).toBe('en')
  })

  it('prefers /ja path prefix over cookie', () => {
    expect(
      resolveRequestLocale({
        pathname: '/ja/posts/article',
        cookieHeader: 'NEXT_LOCALE=en',
        acceptLanguage: null,
      })
    ).toBe('ja')
  })

  it('treats exact /en as en prefix', () => {
    expect(
      resolveRequestLocale({ pathname: '/en', cookieHeader: null, acceptLanguage: 'zh' })
    ).toBe('en')
  })

  it('reads NEXT_LOCALE cookie on non-prefixed paths', () => {
    expect(
      resolveRequestLocale({
        pathname: '/plan/x',
        cookieHeader: 'NEXT_LOCALE=ja',
        acceptLanguage: null,
      })
    ).toBe('ja')
  })

  it('reads NEXT_LOCALE cookie among other cookies', () => {
    expect(
      resolveRequestLocale({
        pathname: '/plan/x',
        cookieHeader: 'foo=1; NEXT_LOCALE=en',
        acceptLanguage: null,
      })
    ).toBe('en')
  })

  it('reads NEXT_LOCALE cookie followed by other cookies', () => {
    expect(
      resolveRequestLocale({
        pathname: '/plan/x',
        cookieHeader: 'NEXT_LOCALE=ja; other=2',
        acceptLanguage: null,
      })
    ).toBe('ja')
  })

  it('ignores invalid cookie values and falls back to accept-language', () => {
    expect(
      resolveRequestLocale({
        pathname: '/plan/x',
        cookieHeader: 'NEXT_LOCALE=fr',
        acceptLanguage: 'ja',
      })
    ).toBe('ja')
  })

  it('does not mistake similarly named cookies for NEXT_LOCALE', () => {
    expect(
      resolveRequestLocale({
        pathname: '/plan/x',
        cookieHeader: 'XNEXT_LOCALE=ja',
        acceptLanguage: 'en-US',
      })
    ).toBe('en')
  })

  it('falls back to accept-language without cookie', () => {
    expect(
      resolveRequestLocale({
        pathname: '/plan/x',
        cookieHeader: null,
        acceptLanguage: 'en-US,en;q=0.9',
      })
    ).toBe('en')
  })

  it('maps unknown accept-language primaries to en', () => {
    expect(
      resolveRequestLocale({ pathname: '/plan/x', cookieHeader: null, acceptLanguage: 'ko' })
    ).toBe('en')
  })

  it('maps zh variants to zh', () => {
    expect(
      resolveRequestLocale({ pathname: '/plan/x', cookieHeader: null, acceptLanguage: 'zh-TW' })
    ).toBe('zh')
  })

  it('falls back to zh for wildcard accept-language', () => {
    expect(
      resolveRequestLocale({
        pathname: '/api/me/plans/1/agent',
        cookieHeader: null,
        acceptLanguage: '*',
      })
    ).toBe('zh')
  })

  it('falls back to zh with no signals at all', () => {
    expect(
      resolveRequestLocale({ pathname: '/plan/x', cookieHeader: null, acceptLanguage: null })
    ).toBe('zh')
  })
})
