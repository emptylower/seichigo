'use client'

import { usePathname } from 'next/navigation'
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

export default function LanguageSwitcher({ locale }: Props) {
  const pathname = usePathname()

  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md px-2 py-1 text-sm text-gray-700 hover:bg-gray-50 hover:text-brand-600">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>{LABELS[locale]}</span>
        <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="absolute right-0 mt-2 w-28 rounded-xl border border-gray-200 bg-white p-1 shadow-lg z-50">
        {(Object.keys(LABELS) as SiteLocale[]).map((l) => (
          <Link
            key={l}
            href={prefixPath(pathname, l)}
            className={`block rounded-lg px-3 py-2 text-sm ${
              l === locale ? 'bg-pink-50 text-brand-600 font-medium' : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
            {LABELS[l]}
          </Link>
        ))}
      </div>
    </details>
  )
}
