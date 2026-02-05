import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const CHINESE_ZONES = new Set(['CN', 'HK', 'TW', 'MO'])
const JAPANESE_ZONES = new Set(['JP'])

const BOT_PATTERN = /bot|crawler|spider|crawling|slurp|externalhit/i

function detectLocale(pathname: string): 'zh' | 'en' | 'ja' {
  if (pathname === '/en' || pathname.startsWith('/en/')) return 'en'
  if (pathname === '/ja' || pathname.startsWith('/ja/')) return 'ja'
  return 'zh'
}

function getLocaleForCountry(country: string): 'zh' | 'en' | 'ja' {
  const upperCountry = country.toUpperCase()
  if (CHINESE_ZONES.has(upperCountry)) return 'zh'
  if (JAPANESE_ZONES.has(upperCountry)) return 'ja'
  return 'en'
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith('/api/')
}

function isBot(userAgent: string | null): boolean {
  if (!userAgent) return false
  return BOT_PATTERN.test(userAgent)
}

function hasLocaleCookie(req: NextRequest): boolean {
  const cookieHeader = req.headers.get('cookie')
  if (!cookieHeader) return false
  return cookieHeader.includes('NEXT_LOCALE=')
}

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname
  const currentLocale = detectLocale(pathname)

  const headers = new Headers(req.headers)
  headers.set('x-seichigo-pathname', pathname)
  headers.set('x-seichigo-locale', currentLocale)

  if (hasLocaleCookie(req)) {
    return NextResponse.next({ request: { headers } })
  }

  if (isApiRoute(pathname)) {
    return NextResponse.next({ request: { headers } })
  }

  const userAgent = req.headers.get('user-agent')
  if (isBot(userAgent)) {
    return NextResponse.next({ request: { headers } })
  }

  const country = req.headers.get('x-vercel-ip-country')
  if (!country) {
    return NextResponse.next({ request: { headers } })
  }

  const targetLocale = getLocaleForCountry(country)

  if (targetLocale === currentLocale) {
    return NextResponse.next({ request: { headers } })
  }

  if (targetLocale === 'zh') {
    return NextResponse.next({ request: { headers } })
  }

  const url = req.nextUrl.clone()
  
  if (currentLocale === 'zh') {
    url.pathname = `/${targetLocale}${pathname}`
  } else {
    const pathWithoutLocale = pathname.replace(/^\/(en|ja)/, '') || '/'
    url.pathname = `/${targetLocale}${pathWithoutLocale}`
  }

  return NextResponse.redirect(url, 307)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|assets/|opengraph-image|twitter-image|sitemap.xml|robots.txt).*)'],
}
