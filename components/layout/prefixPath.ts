import type { SiteLocale } from './SiteShell'

const NON_LOCALIZED_PREFIXES = ['/auth', '/submit', '/admin', '/me', '/api', '/assets']

function isNonLocalizedPath(path: string): boolean {
  return NON_LOCALIZED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))
}

export function prefixPath(path: string, locale: SiteLocale): string {
  const raw = String(path || '').trim() || '/'
  let clean = raw
  
  if (clean === '/en' || clean.startsWith('/en/')) {
    clean = clean.slice(3) || '/'
  } else if (clean === '/ja' || clean.startsWith('/ja/')) {
    clean = clean.slice(3) || '/'
  }

  if (locale === 'zh') return clean
  if (isNonLocalizedPath(clean)) return clean
  if (clean === '/') return `/${locale}`
  return `/${locale}${clean}`
}
