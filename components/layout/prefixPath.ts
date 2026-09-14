import type { SiteLocale } from './SiteShell'

const NON_LOCALIZED_PREFIXES = ['/auth', '/submit', '/admin', '/me', '/plan', '/api', '/assets']

/** `/plan/start` 是 `/plan` 前缀里唯一本地化的例外：公开起始页有三语路径 */
const LOCALIZED_EXACT_PATHS = ['/plan/start']

function isNonLocalizedPath(path: string): boolean {
  return NON_LOCALIZED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))
}

/** query/hash 只在判断路径时剥离，输出时原样保留 */
function splitSuffix(path: string): { pathname: string; suffix: string } {
  const queryIndex = path.indexOf('?')
  const hashIndex = path.indexOf('#')
  let end = path.length
  if (queryIndex >= 0) end = Math.min(end, queryIndex)
  if (hashIndex >= 0) end = Math.min(end, hashIndex)
  return { pathname: path.slice(0, end), suffix: path.slice(end) }
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
  const { pathname, suffix } = splitSuffix(clean)
  if (LOCALIZED_EXACT_PATHS.includes(pathname)) return `/${locale}${pathname}${suffix}`
  if (isNonLocalizedPath(pathname)) return clean
  if (pathname === '/') return `/${locale}${suffix}`
  return `/${locale}${pathname}${suffix}`
}
