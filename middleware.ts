import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { pickLocaleFromAcceptLanguage } from './lib/i18n/acceptLanguage'
import { resolveRequestLocale } from './lib/i18n/resolveRequestLocale'

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
    return '/brand/icons/icon-192.png'
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

/**
 * 登录态提示标记（性能优化 2026-09-07）：有 next-auth 会话 cookie 时在响应上
 * 打非 httpOnly 的 `sg_auth=1`，没有则清除。客户端（Providers/useUsage）据此
 * 跳过匿名访客的 /api/auth/session 与 /api/me/usage 初始化请求。
 * authOptions 未自定义 cookie 名，这里用 next-auth v4 的默认会话 cookie 名。
 */
const SESSION_COOKIE_NAMES = ['__Secure-next-auth.session-token', 'next-auth.session-token']
const AUTH_HINT_COOKIE = 'sg_auth'
/** 与 next-auth 默认会话 maxAge（30 天）同量级 */
const AUTH_HINT_MAX_AGE = 30 * 24 * 60 * 60

function stampAuthHint(req: NextRequest, res: NextResponse): NextResponse {
  const hasSession = SESSION_COOKIE_NAMES.some((name) => req.cookies.has(name))
  if (hasSession) {
    res.cookies.set(AUTH_HINT_COOKIE, '1', {
      path: '/',
      sameSite: 'lax',
      secure: req.nextUrl.protocol === 'https:',
      maxAge: AUTH_HINT_MAX_AGE,
    })
  } else if (req.cookies.has(AUTH_HINT_COOKIE)) {
    res.cookies.set(AUTH_HINT_COOKIE, '', { path: '/', maxAge: 0 })
  }
  return res
}

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname
  const currentLocale = detectLocale(pathname)

  const headers = new Headers(req.headers)
  headers.set('x-seichigo-pathname', pathname)
  headers.set(
    'x-seichigo-locale',
    resolveRequestLocale({
      pathname,
      cookieHeader: req.headers.get('cookie'),
      acceptLanguage: req.headers.get('accept-language'),
    })
  )

  const staticAliasPath = resolveLocaleStaticAlias(pathname)
  if (staticAliasPath) {
    const url = req.nextUrl.clone()
    url.pathname = staticAliasPath
    return stampAuthHint(req, NextResponse.rewrite(url, { request: { headers } }))
  }

  const authAliasPath = resolveLocaleAuthAlias(pathname)
  if (authAliasPath) {
    const url = req.nextUrl.clone()
    url.pathname = authAliasPath
    return stampAuthHint(req, NextResponse.rewrite(url, { request: { headers } }))
  }

  const adminAliasPath = resolveLocaleAdminAlias(pathname)
  if (adminAliasPath) {
    const url = req.nextUrl.clone()
    url.pathname = adminAliasPath
    return stampAuthHint(req, NextResponse.rewrite(url, { request: { headers } }))
  }

  if (hasLocaleCookie(req)) {
    return stampAuthHint(req, NextResponse.next({ request: { headers } }))
  }

  if (isApiRoute(pathname) || isStaticAssetRoute(pathname) || isAdminRoute(pathname)) {
    return stampAuthHint(req, NextResponse.next({ request: { headers } }))
  }

  // Explicit locale prefixes are a deliberate choice by the user or crawler.
  // Never rewrite them by browser language; the same URL must resolve identically for everyone.
  if (currentLocale !== 'zh') {
    return stampAuthHint(req, NextResponse.next({ request: { headers } }))
  }

  const userAgent = req.headers.get('user-agent')
  if (isBot(userAgent)) {
    return stampAuthHint(req, NextResponse.next({ request: { headers } }))
  }

  const targetLocale = pickLocaleFromAcceptLanguage(req.headers.get('accept-language'))

  if (!targetLocale || targetLocale === currentLocale) {
    return stampAuthHint(req, NextResponse.next({ request: { headers } }))
  }

  // Only the bare homepage participates in browser language routing.
  // Deep links must stay stable so shared URLs and crawlers see one canonical target.
  if (pathname !== '/') {
    return stampAuthHint(req, NextResponse.next({ request: { headers } }))
  }

  const url = req.nextUrl.clone()
  url.pathname = `/${targetLocale}`
  return stampAuthHint(req, NextResponse.redirect(url, 307))
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|assets/|opengraph-image|twitter-image|sitemap.xml|robots.txt|.*\\..*).*)',
    '/(en|ja)/(manifest\\.webmanifest|favicon\\.png|favicon\\.ico|brand/app-logo\\.png)',
  ],
}
