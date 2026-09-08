import { getSiteOrigin } from '@/lib/seo/site'

type HreflangMap = Record<string, string>

export function buildHreflangAlternates(input: {
  canonicalPath: string
  zhPath: string
  enPath: string
  jaPath: string
  includeXDefault?: boolean
}): { canonical: string; languages: HreflangMap } {
  const origin = getSiteOrigin()
  const includeXDefault = input.includeXDefault !== false

  const canonicalPath = normalizePath(input.canonicalPath)
  const zhPath = normalizePath(input.zhPath)
  const enPath = normalizePath(input.enPath)
  const jaPath = normalizePath(input.jaPath)

  const canonical = encodePathOnce(canonicalPath)
  const toAbsoluteUrl = (path: string) => new URL(encodePathOnce(path), origin).toString()

  const languages: HreflangMap = {
    zh: toAbsoluteUrl(zhPath),
    en: toAbsoluteUrl(enPath),
    ja: toAbsoluteUrl(jaPath),
  }

  if (includeXDefault) {
    languages['x-default'] = toAbsoluteUrl(zhPath)
  }

  return {
    canonical,
    languages,
  }
}

export function buildZhAlternates(input: { path: string; includeXDefault?: boolean }) {
  const zhPath = normalizePath(input.path)
  const enPath = zhPath === '/' ? '/en' : `/en${zhPath}`
  const jaPath = zhPath === '/' ? '/ja' : `/ja${zhPath}`
  return buildHreflangAlternates({
    canonicalPath: zhPath,
    zhPath,
    enPath,
    jaPath,
    includeXDefault: input.includeXDefault,
  })
}

export function buildEnAlternates(input: { zhPath: string; enPath?: string; includeXDefault?: boolean }) {
  const zhPath = normalizePath(input.zhPath)
  const enPath = normalizePath(input.enPath ?? (zhPath === '/' ? '/en' : `/en${zhPath}`))
  const jaPath = zhPath === '/' ? '/ja' : `/ja${zhPath}`
  return buildHreflangAlternates({
    canonicalPath: enPath,
    zhPath,
    enPath,
    jaPath,
    includeXDefault: input.includeXDefault,
  })
}

export function buildJaAlternates(input: { zhPath: string; jaPath?: string; includeXDefault?: boolean }) {
  const zhPath = normalizePath(input.zhPath)
  const enPath = zhPath === '/' ? '/en' : `/en${zhPath}`
  const jaPath = normalizePath(input.jaPath ?? (zhPath === '/' ? '/ja' : `/ja${zhPath}`))
  return buildHreflangAlternates({
    canonicalPath: jaPath,
    zhPath,
    enPath,
    jaPath,
    includeXDefault: input.includeXDefault,
  })
}

function normalizePath(path: string): string {
  const raw = String(path || '').trim()
  if (!raw || raw === '/') return '/'
  return raw.startsWith('/') ? raw.replace(/\/$/, '') : `/${raw.replace(/\/$/, '')}`
}

/**
 * 路径只做一次百分号编码：文章页传入的路径常已过 encodeSlugForPath 编码，
 * 直接 encodeURI 会把 `%E4` 变成 `%25E4`。先尝试 decodeURI 还原（失败则原样），
 * 再统一 encodeURI，保证已编码与未编码输入产出一致。
 */
function encodePathOnce(path: string): string {
  let decoded = path
  try {
    decoded = decodeURI(path)
  } catch {
    decoded = path
  }
  return encodeURI(decoded)
}
