import { getSiteOrigin } from '@/lib/seo/site'

type HreflangMap = Record<string, string>

export function buildHreflangAlternates(input: {
  canonicalPath: string
  zhPath: string
  enPath: string
  includeXDefault?: boolean
}): { canonical: string; languages: HreflangMap } {
  const origin = getSiteOrigin()
  const includeXDefault = input.includeXDefault !== false

  const languages: HreflangMap = {
    zh: `${origin}${input.zhPath}`,
    en: `${origin}${input.enPath}`,
  }

  if (includeXDefault) {
    languages['x-default'] = `${origin}${input.zhPath}`
  }

  return {
    canonical: input.canonicalPath,
    languages,
  }
}

export function buildZhAlternates(input: { path: string; includeXDefault?: boolean }) {
  const zhPath = normalizePath(input.path)
  const enPath = zhPath === '/' ? '/en' : `/en${zhPath}`
  return buildHreflangAlternates({
    canonicalPath: zhPath,
    zhPath,
    enPath,
    includeXDefault: input.includeXDefault,
  })
}

export function buildEnAlternates(input: { zhPath: string; enPath?: string; includeXDefault?: boolean }) {
  const zhPath = normalizePath(input.zhPath)
  const enPath = normalizePath(input.enPath ?? (zhPath === '/' ? '/en' : `/en${zhPath}`))
  return buildHreflangAlternates({
    canonicalPath: enPath,
    zhPath,
    enPath,
    includeXDefault: input.includeXDefault,
  })
}

function normalizePath(path: string): string {
  const raw = String(path || '').trim()
  if (!raw || raw === '/') return '/'
  return raw.startsWith('/') ? raw.replace(/\/$/, '') : `/${raw.replace(/\/$/, '')}`
}
