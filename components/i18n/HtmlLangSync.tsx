'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

function localeFromPathname(pathname: string): 'zh' | 'en' {
  return pathname === '/en' || pathname.startsWith('/en/') ? 'en' : 'zh'
}

export default function HtmlLangSync() {
  const pathname = usePathname()

  useEffect(() => {
    const locale = localeFromPathname(pathname)
    document.documentElement.lang = locale
  }, [pathname])

  return null
}
