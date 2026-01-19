import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

function detectLocale(pathname: string): 'zh' | 'en' {
  return pathname === '/en' || pathname.startsWith('/en/') ? 'en' : 'zh'
}

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname
  const locale = detectLocale(pathname)

  const headers = new Headers(req.headers)
  headers.set('x-seichigo-pathname', pathname)
  headers.set('x-seichigo-locale', locale)

  return NextResponse.next({
    request: { headers },
  })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|assets/|opengraph-image|twitter-image).*)'],
}
