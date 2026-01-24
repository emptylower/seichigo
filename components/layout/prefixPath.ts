import type { SiteLocale } from './SiteShell'

const NON_LOCALIZED_PREFIXES = ['/auth', '/submit', '/admin', '/me', '/api', '/assets']

function isNonLocalizedPath(path: string): boolean {
  return NON_LOCALIZED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))
}

export function prefixPath(path: string, locale: SiteLocale): string {
  const raw = String(path || '').trim() || '/'
  const clean = raw.startsWith('/en') ? raw.slice(3) || '/' : raw
  if (locale !== 'en') return clean
  if (isNonLocalizedPath(clean)) return clean
  if (clean === '/') return '/en'
  return `/en${clean}`
}
