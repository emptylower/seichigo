import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '../../middleware'

function createRequest(
  path: string,
  options: {
    country?: string
    cookie?: string
    userAgent?: string
  } = {}
): NextRequest {
  const url = `https://seichigo.com${path}`
  const headers = new Headers()
  
  if (options.country) {
    headers.set('x-vercel-ip-country', options.country)
  }
  if (options.cookie) {
    headers.set('cookie', options.cookie)
  }
  if (options.userAgent) {
    headers.set('user-agent', options.userAgent)
  }
  
  return new NextRequest(url, { headers })
}

describe('i18n IP-based redirect middleware', () => {
  describe('cookie override (user preference)', () => {
    it('skips redirect when NEXT_LOCALE cookie exists', () => {
      const req = createRequest('/', { country: 'US', cookie: 'NEXT_LOCALE=zh' })
      const res = middleware(req)
      
      expect(res.status).not.toBe(307)
    })

    it('skips redirect when cookie specifies en locale', () => {
      const req = createRequest('/', { country: 'CN', cookie: 'NEXT_LOCALE=en' })
      const res = middleware(req)
      
      expect(res.status).not.toBe(307)
    })

    it('skips redirect when cookie specifies ja locale', () => {
      const req = createRequest('/', { country: 'US', cookie: 'NEXT_LOCALE=ja' })
      const res = middleware(req)
      
      expect(res.status).not.toBe(307)
    })
  })

  describe('Chinese zones - no redirect (already zh default)', () => {
    const chineseZones = ['CN', 'HK', 'TW', 'MO']
    
    chineseZones.forEach((zone) => {
      it(`does not redirect for ${zone} on root path`, () => {
        const req = createRequest('/', { country: zone })
        const res = middleware(req)
        
        expect(res.status).not.toBe(307)
      })

      it(`does not redirect for ${zone} on /posts/some-article`, () => {
        const req = createRequest('/posts/some-article', { country: zone })
        const res = middleware(req)
        
        expect(res.status).not.toBe(307)
      })
    })
  })

  describe('Japanese zone - redirect to /ja/', () => {
    it('redirects JP users on root to /ja/', () => {
      const req = createRequest('/', { country: 'JP' })
      const res = middleware(req)
      
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toMatch(/^https:\/\/seichigo\.com\/ja\/?$/)
    })

    it('redirects JP users on /posts/article to /ja/posts/article', () => {
      const req = createRequest('/posts/some-article', { country: 'JP' })
      const res = middleware(req)
      
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toBe('https://seichigo.com/ja/posts/some-article')
    })

    it('preserves query string when redirecting JP users', () => {
      const req = createRequest('/posts/article?ref=twitter&utm_source=x', { country: 'JP' })
      const res = middleware(req)
      
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toBe('https://seichigo.com/ja/posts/article?ref=twitter&utm_source=x')
    })

    it('does not redirect JP users already on /ja/ path', () => {
      const req = createRequest('/ja/posts/article', { country: 'JP' })
      const res = middleware(req)
      
      expect(res.status).not.toBe(307)
    })
  })

  describe('other countries - redirect to /en/', () => {
    const otherCountries = ['US', 'GB', 'DE', 'FR', 'KR', 'AU', 'BR']
    
    otherCountries.forEach((country) => {
      it(`redirects ${country} users on root to /en/`, () => {
        const req = createRequest('/', { country })
        const res = middleware(req)
        
        expect(res.status).toBe(307)
        expect(res.headers.get('location')).toMatch(/^https:\/\/seichigo\.com\/en\/?$/)
      })
    })

    it('redirects US users on /posts/article to /en/posts/article', () => {
      const req = createRequest('/posts/some-article', { country: 'US' })
      const res = middleware(req)
      
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toBe('https://seichigo.com/en/posts/some-article')
    })

    it('preserves query string when redirecting to /en/', () => {
      const req = createRequest('/posts/article?page=2&sort=date', { country: 'US' })
      const res = middleware(req)
      
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toBe('https://seichigo.com/en/posts/article?page=2&sort=date')
    })

    it('does not redirect US users already on /en/ path', () => {
      const req = createRequest('/en/posts/article', { country: 'US' })
      const res = middleware(req)
      
      expect(res.status).not.toBe(307)
    })
  })

  describe('API routes - skip redirect', () => {
    it('does not redirect /api/articles', () => {
      const req = createRequest('/api/articles', { country: 'US' })
      const res = middleware(req)
      
      expect(res.status).not.toBe(307)
    })

    it('does not redirect /api/auth/session', () => {
      const req = createRequest('/api/auth/session', { country: 'JP' })
      const res = middleware(req)
      
      expect(res.status).not.toBe(307)
    })

    it('does not redirect nested api routes', () => {
      const req = createRequest('/api/admin/translations/batch', { country: 'US' })
      const res = middleware(req)
      
      expect(res.status).not.toBe(307)
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
        const req = createRequest('/', { country: 'US', userAgent })
        const res = middleware(req)
        
        expect(res.status).not.toBe(307)
      })
    })

    it('still redirects normal browser user agents', () => {
      const req = createRequest('/', {
        country: 'US',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      })
      const res = middleware(req)
      
      expect(res.status).toBe(307)
    })
  })

  describe('no country header - no redirect', () => {
    it('does not redirect when x-vercel-ip-country is missing', () => {
      const req = createRequest('/')
      const res = middleware(req)
      
      expect(res.status).not.toBe(307)
    })

    it('does not redirect on deep paths without country', () => {
      const req = createRequest('/posts/some-article')
      const res = middleware(req)
      
      expect(res.status).not.toBe(307)
    })
  })

  describe('middleware still sets custom headers', () => {
    it('sets x-seichigo-pathname header', () => {
      const req = createRequest('/posts/article', { country: 'CN' })
      const res = middleware(req)
      
      const pathnameHeader = res.headers.get('x-seichigo-pathname') || 
        res.headers.get('x-middleware-request-x-seichigo-pathname')
      expect(pathnameHeader).toBeTruthy()
    })

    it('sets x-seichigo-locale header', () => {
      const req = createRequest('/en/posts/article', { country: 'CN' })
      const res = middleware(req)
      
      const localeHeader = res.headers.get('x-seichigo-locale') || 
        res.headers.get('x-middleware-request-x-seichigo-locale')
      expect(localeHeader).toBeTruthy()
    })
  })

  describe('edge cases', () => {
    it('handles empty path correctly', () => {
      const req = createRequest('', { country: 'JP' })
      const res = middleware(req)
      
      expect(res.status).toBe(307)
    })

    it('handles path with multiple segments', () => {
      const req = createRequest('/city/tokyo/spots', { country: 'US' })
      const res = middleware(req)
      
      expect(res.status).toBe(307)
      expect(res.headers.get('location')).toBe('https://seichigo.com/en/city/tokyo/spots')
    })

    it('handles lowercase country codes', () => {
      const req = createRequest('/', { country: 'jp' })
      const res = middleware(req)
      
      expect(res.status).toBe(307)
    })
  })
})
