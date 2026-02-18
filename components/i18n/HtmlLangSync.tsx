'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

function localeFromPathname(pathname: string): 'zh' | 'en' | 'ja' {
  if (pathname === '/en' || pathname.startsWith('/en/')) return 'en'
  if (pathname === '/ja' || pathname.startsWith('/ja/')) return 'ja'
  return 'zh'
}

export default function HtmlLangSync() {
  const pathname = usePathname()

  useEffect(() => {
    const locale = localeFromPathname(pathname)
    document.documentElement.lang = locale
  }, [pathname])

  return null
}
