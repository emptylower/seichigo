import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '../../middleware'

function createRequest(
  path: string,
  options: {
    acceptLanguage?: string
    cookie?: string
    userAgent?: string
  } = {}
): NextRequest {
  const url = `https://seichigo.com${path}`
  const headers = new Headers()

  if (options.acceptLanguage !== undefined) {
    headers.set('accept-language', options.acceptLanguage)
  }
  if (options.cookie) {
    headers.set('cookie', options.cookie)
  }
  if (options.userAgent) {
    headers.set('user-agent', options.userAgent)
  }

  return new NextRequest(url, { headers })
}

describe('i18n Accept-Language redirect middleware', () => {
  describe('cookie override (user preference)', () => {
    it('skips redirect when NEXT_LOCALE cookie exists', () => {
      const req = createRequest('/', { acceptLanguage: 'en-US', cookie: 'NEXT_LOCALE=zh' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
    })

    it('skips redirect when cookie specifies en locale', () => {
      const req = createRequest('/', { acceptLanguage: 'zh-CN', cookie: 'NEXT_LOCALE=en' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
    })

    it('skips redirect when cookie specifies ja locale', () => {
      const req = createRequest('/', { acceptLanguage: 'en-US', cookie: 'NEXT_LOCALE=ja' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
    })
  })

  describe('zh browsers - no redirect (already zh default)', () => {
    const zhHeaders = ['zh', 'zh-CN', 'zh-TW', 'zh-HK', 'zh-MO']

    zhHeaders.forEach((acceptLanguage) => {
      it(`does not redirect for ${acceptLanguage} on root path`, () => {
        const req = createRequest('/', { acceptLanguage })
        const res = middleware(req)

        expect(res.status).not.toBe(307)
      })

      it(`does not redirect for ${acceptLanguage} on /posts/some-article`, () => {
        const req = createRequest('/posts/some-article', { acceptLanguage })
        const res = middleware(req)

        expect(res.status).not.toBe(307)
      })
    })
  })

  describe('ja browsers - redirect to /ja/', () => {
    it('redirects ja users on root to /ja/', () => {
      const req = createRequest('/', { acceptLanguage: 'ja' })
      const res = middleware(req)

      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toMatch(/^https:\/\/seichigo\.com\/ja\/?$/)
    })

    it('redirects ja-JP users on root to /ja/', () => {
      const req = createRequest('/', { acceptLanguage: 'ja-JP,en;q=0.8' })
      const res = middleware(req)

      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toMatch(/^https:\/\/seichigo\.com\/ja\/?$/)
    })

    it('keeps deep zh article paths stable for ja users', () => {
      const req = createRequest('/posts/some-article', { acceptLanguage: 'ja' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
      expect(res.headers.get('location')).toBeNull()
    })

    it('keeps query-string deep links stable for ja users', () => {
      const req = createRequest('/posts/article?ref=twitter&utm_source=x', { acceptLanguage: 'ja' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
      expect(res.headers.get('location')).toBeNull()
    })

    it('does not redirect ja users already on /ja/ path', () => {
      const req = createRequest('/ja/posts/article', { acceptLanguage: 'ja' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
    })
  })

  describe('other languages - redirect to /en/', () => {
    const otherHeaders = ['en', 'en-US', 'en-GB', 'ko-KR', 'fr-FR', 'de-DE', 'ru', 'es-ES']

    otherHeaders.forEach((acceptLanguage) => {
      it(`redirects ${acceptLanguage} users on root to /en/`, () => {
        const req = createRequest('/', { acceptLanguage })
        const res = middleware(req)

        expect(res.status).toBe(307)
        expect(res.headers.get('location')).toMatch(/^https:\/\/seichigo\.com\/en\/?$/)
      })
    })

    it('keeps deep zh article paths stable for en users', () => {
      const req = createRequest('/posts/some-article', { acceptLanguage: 'en-US' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
      expect(res.headers.get('location')).toBeNull()
    })

    it('keeps query-string deep links stable for en users', () => {
      const req = createRequest('/posts/article?page=2&sort=date', { acceptLanguage: 'en-US' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
      expect(res.headers.get('location')).toBeNull()
    })

    it('does not redirect en users already on /en/ path', () => {
      const req = createRequest('/en/posts/article', { acceptLanguage: 'en-US' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
    })
  })

  describe('q-value ordering drives the redirect target', () => {
    it('redirects to /ja when ja outranks en', () => {
      const req = createRequest('/', { acceptLanguage: 'en;q=0.5, ja;q=0.9' })
      const res = middleware(req)

      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toMatch(/^https:\/\/seichigo\.com\/ja\/?$/)
    })

    it('redirects to /en when en outranks ja', () => {
      const req = createRequest('/', { acceptLanguage: 'ja;q=0.4, en-US;q=0.9' })
      const res = middleware(req)

      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toMatch(/^https:\/\/seichigo\.com\/en\/?$/)
    })
  })

  describe('API routes - skip redirect', () => {
    it('does not redirect /api/articles', () => {
      const req = createRequest('/api/articles', { acceptLanguage: 'en-US' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
    })

    it('does not redirect /api/auth/session', () => {
      const req = createRequest('/api/auth/session', { acceptLanguage: 'ja' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
    })

    it('does not redirect nested api routes', () => {
      const req = createRequest('/api/admin/translations/batch', { acceptLanguage: 'en-US' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
    })
  })

  describe('admin routes - skip locale redirect', () => {
    it('does not redirect /admin/ops for en browsers', () => {
      const req = createRequest('/admin/ops', { acceptLanguage: 'en-US' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
      expect(res.headers.get('location')).toBeNull()
    })

    it('does not redirect /admin/ops/map-image-diagnostics for ja browsers', () => {
      const req = createRequest('/admin/ops/map-image-diagnostics', { acceptLanguage: 'ja' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
      expect(res.headers.get('location')).toBeNull()
    })
  })

  describe('static files - skip redirect', () => {
    it('does not redirect /manifest.webmanifest', () => {
      const req = createRequest('/manifest.webmanifest', { acceptLanguage: 'en-US' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
      expect(res.headers.get('location')).toBeNull()
    })

    it('does not redirect public assets under /brand', () => {
      const req = createRequest('/brand/app-logo.png', { acceptLanguage: 'ja' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
      expect(res.headers.get('location')).toBeNull()
    })

    it('rewrites locale-prefixed manifest path to root manifest', () => {
      const req = createRequest('/en/manifest.webmanifest', { acceptLanguage: 'en-US' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
      expect(res.headers.get('location')).toBeNull()
      expect(res.headers.get('x-middleware-rewrite')).toBe('https://seichigo.com/manifest.webmanifest')
    })

    it('rewrites locale-prefixed favicon fallback to the cached icon', () => {
      const req = createRequest('/ja/favicon.png', { acceptLanguage: 'ja' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
      expect(res.headers.get('location')).toBeNull()
      expect(res.headers.get('x-middleware-rewrite')).toBe('https://seichigo.com/brand/icons/icon-192.png')
    })
  })

  describe('auth locale alias rewrite', () => {
    it('rewrites /en/auth/signin to /auth/signin', () => {
      const req = createRequest('/en/auth/signin', { acceptLanguage: 'en-US' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
      expect(res.headers.get('location')).toBeNull()
      expect(res.headers.get('x-middleware-rewrite')).toBe('https://seichigo.com/auth/signin')
    })

    it('rewrites /ja/auth/signup with query string preserved', () => {
      const req = createRequest('/ja/auth/signup?callbackUrl=%2Fja%2Fsubmit', { acceptLanguage: 'ja' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
      expect(res.headers.get('location')).toBeNull()
      expect(res.headers.get('x-middleware-rewrite')).toBe('https://seichigo.com/auth/signup?callbackUrl=%2Fja%2Fsubmit')
    })
  })

  describe('admin locale alias rewrite', () => {
    it('rewrites /en/admin/ops to /admin/ops', () => {
      const req = createRequest('/en/admin/ops', { acceptLanguage: 'en-US' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
      expect(res.headers.get('location')).toBeNull()
      expect(res.headers.get('x-middleware-rewrite')).toBe('https://seichigo.com/admin/ops')
    })

    it('rewrites /ja/admin/ops/map-image-diagnostics preserving query string', () => {
      const req = createRequest('/ja/admin/ops/map-image-diagnostics?tab=recent', { acceptLanguage: 'ja' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
      expect(res.headers.get('location')).toBeNull()
      expect(res.headers.get('x-middleware-rewrite')).toBe('https://seichigo.com/admin/ops/map-image-diagnostics?tab=recent')
    })
  })

  describe('bot detection - skip redirect', () => {
    const botUserAgents = [
      'Googlebot/2.1 (+http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; Bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)',
      'DuckDuckBot/1.0; (+http://duckduckgo.com/duckduckbot.html)',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Twitterbot/1.0',
      'LinkedInBot/1.0',
      'Slackbot-LinkExpanding 1.0',
      'Mozilla/5.0 (compatible; crawler)',
      'spider-bot/1.0',
      'Some Crawling Agent',
    ]

    botUserAgents.forEach((userAgent) => {
      it(`does not redirect bot: ${userAgent.substring(0, 30)}...`, () => {
        const req = createRequest('/', { acceptLanguage: 'en-US', userAgent })
        const res = middleware(req)

        expect(res.status).not.toBe(307)
      })
    })

    it('still redirects normal browser user agents', () => {
      const req = createRequest('/', {
        acceptLanguage: 'en-US',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      })
      const res = middleware(req)

      expect(res.status).toBe(307)
    })
  })

  describe('no accept-language header - no redirect', () => {
    it('does not redirect when accept-language is missing', () => {
      const req = createRequest('/')
      const res = middleware(req)

      expect(res.status).not.toBe(307)
    })

    it('does not redirect when accept-language is empty', () => {
      const req = createRequest('/', { acceptLanguage: '' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
    })

    it('does not redirect when accept-language is only a wildcard', () => {
      const req = createRequest('/', { acceptLanguage: '*' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
    })

    it('does not redirect on deep paths without accept-language', () => {
      const req = createRequest('/posts/some-article')
      const res = middleware(req)

      expect(res.status).not.toBe(307)
    })
  })

  describe('middleware still sets custom headers', () => {
    it('sets x-seichigo-pathname header', () => {
      const req = createRequest('/posts/article', { acceptLanguage: 'zh-CN' })
      const res = middleware(req)

      const pathnameHeader = res.headers.get('x-seichigo-pathname') ||
        res.headers.get('x-middleware-request-x-seichigo-pathname')
      expect(pathnameHeader).toBeTruthy()
    })

    it('sets x-seichigo-locale header', () => {
      const req = createRequest('/en/posts/article', { acceptLanguage: 'zh-CN' })
      const res = middleware(req)

      const localeHeader = res.headers.get('x-seichigo-locale') ||
        res.headers.get('x-middleware-request-x-seichigo-locale')
      expect(localeHeader).toBeTruthy()
    })
  })

  describe('x-seichigo-locale request header', () => {
    function requestLocaleHeader(res: ReturnType<typeof middleware>): string | null {
      return (
        res.headers.get('x-seichigo-locale') ||
        res.headers.get('x-middleware-request-x-seichigo-locale')
      )
    }

    it('propagates NEXT_LOCALE cookie locale on non-prefixed plan paths', () => {
      const req = createRequest('/plan/x', { cookie: 'NEXT_LOCALE=ja' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
      expect(requestLocaleHeader(res)).toBe('ja')
    })

    it('propagates accept-language locale on non-prefixed plan paths without cookie', () => {
      const req = createRequest('/plan/x', { acceptLanguage: 'en-US,en;q=0.9' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
      expect(requestLocaleHeader(res)).toBe('en')
    })

    it('falls back to zh for wildcard accept-language on api routes', () => {
      const req = createRequest('/api/me/plans/1/agent', { acceptLanguage: '*' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
      expect(requestLocaleHeader(res)).toBe('zh')
    })

    it('keeps path-prefix locale even when cookie disagrees', () => {
      const req = createRequest('/en/posts/article', { cookie: 'NEXT_LOCALE=ja' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
      expect(requestLocaleHeader(res)).toBe('en')
    })
  })

  describe('edge cases', () => {
    it('handles empty path correctly', () => {
      const req = createRequest('', { acceptLanguage: 'ja' })
      const res = middleware(req)

      expect(res.status).toBe(307)
    })

    it('keeps paths with multiple segments stable', () => {
      const req = createRequest('/city/tokyo/spots', { acceptLanguage: 'en-US' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
      expect(res.headers.get('location')).toBeNull()
    })

    it('handles uppercase language tags', () => {
      const req = createRequest('/', { acceptLanguage: 'JA' })
      const res = middleware(req)

      expect(res.status).toBe(307)
    })

    it('handles mixed-case language tags', () => {
      const req = createRequest('/', { acceptLanguage: 'En-us' })
      const res = middleware(req)

      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toMatch(/^https:\/\/seichigo\.com\/en\/?$/)
    })
  })

  describe('URL stability for AdSense', () => {
    it('never rewrites an explicit /en path based on browser language', () => {
      const req = createRequest('/en/anime', { acceptLanguage: 'ja' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
      expect(res.headers.get('location')).toBeNull()
    })

    it('never rewrites an explicit /ja path based on browser language', () => {
      const req = createRequest('/ja/anime', { acceptLanguage: 'en-US' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
      expect(res.headers.get('location')).toBeNull()
    })

    it('keeps deep zh paths stable regardless of browser language', () => {
      const req = createRequest('/posts/some-guide', { acceptLanguage: 'ja' })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
      expect(res.headers.get('location')).toBeNull()
    })

    it('still redirects the bare homepage by browser language', () => {
      const req = createRequest('/', { acceptLanguage: 'ja' })
      const res = middleware(req)

      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toBe('https://seichigo.com/ja')
    })

    it.each([
      'Mediapartners-Google',
      'Mozilla/5.0 (compatible; AdsBot-Google; +http://www.google.com/adsbot.html)',
      'Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)',
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; Google-Extended;)',
      'Mozilla/5.0 (compatible; Chrome-Lighthouse;)',
    ])('never redirects Google crawler UA: %s', (userAgent) => {
      const req = createRequest('/', { acceptLanguage: 'ja', userAgent })
      const res = middleware(req)

      expect(res.status).not.toBe(307)
      expect(res.headers.get('location')).toBeNull()
    })
  })
})
