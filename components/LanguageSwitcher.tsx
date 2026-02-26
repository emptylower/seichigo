'use client'

import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { prefixPath } from '@/components/layout/prefixPath'
import type { SiteLocale } from '@/components/layout/SiteShell'

type Props = {
  locale: SiteLocale
}

const LABELS: Record<SiteLocale, string> = {
  zh: '中文',
  en: 'English',
  ja: '日本語',
}

function setLocaleCookie(locale: SiteLocale) {
  document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=31536000; SameSite=Lax`
}

function isArticlePage(pathname: string): boolean {
  return pathname.includes('/posts/')
}

function extractSlugFromPathname(pathname: string): string {
  const match = pathname.match(/\/posts\/([^/]+)/)
  return match ? match[1] : ''
}

async function fetchTranslatedSlug(
  slug: string,
  currentLang: string,
  targetLang: string
): Promise<string | null> {
  try {
    const res = await fetch(
      `/api/articles/translations?slug=${encodeURIComponent(slug)}&currentLang=${currentLang}&targetLang=${targetLang}`
    )
    if (!res.ok) return null
    const data = await res.json()
    return data.translatedSlug || null
  } catch {
    return null
  }
}

export default function LanguageSwitcher({ locale }: Props) {
  const pathname = usePathname()
  const router = useRouter()

  const handleLanguageClick = async (targetLocale: SiteLocale, e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    setLocaleCookie(targetLocale)

    if (!isArticlePage(pathname)) {
      router.push(prefixPath(pathname, targetLocale))
      return
    }

    const slug = extractSlugFromPathname(pathname)
    if (!slug) {
      router.push(prefixPath(pathname, targetLocale))
      return
    }

    const translatedSlug = await fetchTranslatedSlug(slug, locale, targetLocale)

    if (translatedSlug) {
      const targetPath = targetLocale === 'zh' ? `/posts/${translatedSlug}` : `/${targetLocale}/posts/${translatedSlug}`
      router.push(targetPath)
    } else {
      router.push(prefixPath(pathname, targetLocale))
    }
  }

  return (
    <details className="group relative z-[70]">
      <summary className="flex h-11 cursor-pointer list-none items-center justify-between rounded-xl px-3 text-[15px] font-medium text-slate-700 transition hover:bg-slate-50 hover:text-brand-700 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{LABELS[locale]}</span>
        </span>
        <svg className="h-4 w-4 text-slate-400 transition group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>

      <div className="absolute left-0 top-[calc(100%+0.5rem)] z-[80] w-40 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
        {(Object.keys(LABELS) as SiteLocale[]).map((l) => (
          <Link
            key={l}
            href={prefixPath(pathname, l)}
            prefetch={false}
            onClick={(e) => handleLanguageClick(l, e)}
            className={`block rounded-lg px-3 py-2 text-sm ${
              l === locale ? 'bg-brand-50 text-brand-700 font-medium' : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            {LABELS[l]}
          </Link>
        ))}
      </div>
    </details>
  )
}
