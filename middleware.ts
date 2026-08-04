import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const CHINESE_ZONES = new Set(['CN', 'HK', 'TW', 'MO'])
const JAPANESE_ZONES = new Set(['JP'])
const STATIC_FILE_EXT_PATTERN = /\/[^/]+\.[^/]+$/
const LOCALE_PREFIXED_STATIC_ALIAS_PATTERN = /^\/(en|ja)\/(?:manifest\.webmanifest|favicon\.ico|favicon\.png|brand\/app-logo\.png)$/
const LOCALE_PREFIXED_AUTH_ALIAS_PATTERN = /^\/(en|ja)\/auth(?:\/.*)?$/
const LOCALE_PREFIXED_ADMIN_ALIAS_PATTERN = /^\/(en|ja)\/admin(?:\/.*)?$/

const BOT_PATTERN =
  /bot|crawler|spider|crawling|slurp|externalhit|mediapartners|adsbot|google-inspectiontool|google-extended|chrome-lighthouse/i

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

function isAdminRoute(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/')
}

function isStaticAssetRoute(pathname: string): boolean {
  return STATIC_FILE_EXT_PATTERN.test(pathname)
}

function isBot(userAgent: string | null): boolean {
  if (!userAgent) return false
  return BOT_PATTERN.test(userAgent)
}

function resolveLocaleStaticAlias(pathname: string): string | null {
  if (!LOCALE_PREFIXED_STATIC_ALIAS_PATTERN.test(pathname)) return null
  const withoutLocale = pathname.replace(/^\/(en|ja)(?=\/)/, '')
  if (withoutLocale === '/favicon.png') {
    return '/brand/app-logo.png'
  }
  return withoutLocale
}

function resolveLocaleAuthAlias(pathname: string): string | null {
  if (!LOCALE_PREFIXED_AUTH_ALIAS_PATTERN.test(pathname)) return null
  return pathname.replace(/^\/(en|ja)(?=\/auth(?:\/|$))/, '')
}

function resolveLocaleAdminAlias(pathname: string): string | null {
  if (!LOCALE_PREFIXED_ADMIN_ALIAS_PATTERN.test(pathname)) return null
  return pathname.replace(/^\/(en|ja)(?=\/admin(?:\/|$))/, '')
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

  const staticAliasPath = resolveLocaleStaticAlias(pathname)
  if (staticAliasPath) {
    const url = req.nextUrl.clone()
    url.pathname = staticAliasPath
    return NextResponse.rewrite(url, { request: { headers } })
  }

  const authAliasPath = resolveLocaleAuthAlias(pathname)
  if (authAliasPath) {
    const url = req.nextUrl.clone()
    url.pathname = authAliasPath
    return NextResponse.rewrite(url, { request: { headers } })
  }

  const adminAliasPath = resolveLocaleAdminAlias(pathname)
  if (adminAliasPath) {
    const url = req.nextUrl.clone()
    url.pathname = adminAliasPath
    return NextResponse.rewrite(url, { request: { headers } })
  }

  if (hasLocaleCookie(req)) {
    return NextResponse.next({ request: { headers } })
  }

  if (isApiRoute(pathname) || isStaticAssetRoute(pathname) || isAdminRoute(pathname)) {
    return NextResponse.next({ request: { headers } })
  }

  // Explicit locale prefixes are a deliberate choice by the user or crawler.
  // Never rewrite them by IP; the same URL must resolve identically for everyone.
  if (currentLocale !== 'zh') {
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

  // Only the bare homepage participates in geo language routing.
  // Deep links must stay stable so shared URLs and crawlers see one canonical target.
  if (pathname !== '/') {
    return NextResponse.next({ request: { headers } })
  }

  const url = req.nextUrl.clone()
  url.pathname = `/${targetLocale}`
  return NextResponse.redirect(url, 307)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|assets/|opengraph-image|twitter-image|sitemap.xml|robots.txt|.*\\..*).*)',
    '/(en|ja)/(manifest\\.webmanifest|favicon\\.png|favicon\\.ico|brand/app-logo\\.png)',
  ],
}
