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

  const canonicalPath = normalizePath(input.canonicalPath)
  const zhPath = normalizePath(input.zhPath)
  const enPath = normalizePath(input.enPath)

  const canonical = encodeURI(canonicalPath)
  const toAbsoluteUrl = (path: string) => new URL(encodeURI(path), origin).toString()

  const languages: HreflangMap = {
    zh: toAbsoluteUrl(zhPath),
    en: toAbsoluteUrl(enPath),
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

export function buildJaAlternates(input: { zhPath: string; jaPath?: string; includeXDefault?: boolean }) {
  const zhPath = normalizePath(input.zhPath)
  const jaPath = normalizePath(input.jaPath ?? (zhPath === '/' ? '/ja' : `/ja${zhPath}`))
  const origin = getSiteOrigin()
  const toAbsoluteUrl = (path: string) => new URL(encodeURI(path), origin).toString()

  const languages: HreflangMap = {
    zh: toAbsoluteUrl(zhPath),
    ja: toAbsoluteUrl(jaPath),
  }

  if (input.includeXDefault !== false) {
    languages['x-default'] = toAbsoluteUrl(zhPath)
  }

  return {
    canonical: encodeURI(jaPath),
    languages,
  }
}

function normalizePath(path: string): string {
  const raw = String(path || '').trim()
  if (!raw || raw === '/') return '/'
  return raw.startsWith('/') ? raw.replace(/\/$/, '') : `/${raw.replace(/\/$/, '')}`
}
