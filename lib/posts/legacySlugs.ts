import { normalizeArticleSlug } from '@/lib/article/slug'

export const LEGACY_POST_SLUGS: Readonly<Record<string, string>> = {
  '你的名字-your-name-seichigo-tokyo-shinjuku': 'your-name-pilgrimage-part1-tokyo-shinjuku',
  '你的名字-your-name-tokyo-minato-ward': 'your-name-pilgrimage-part2-tokyo-minato',
  '你的名字-your-name-tokyo-from-hida-to-suwa': 'your-name-pilgrimage-part3-hida-to-suwa',
}

function safeDecodeURIComponent(input: string): string {
  if (!/%[0-9a-fA-F]{2}/.test(input)) return input
  try {
    return decodeURIComponent(input)
  } catch {
    return input
  }
}

/** 输入原始路由参数（可能是 percent-encoded），命中旧 slug 时返回新 slug，否则 null */
export function resolveLegacyPostSlug(rawSlug: string): string | null {
  const trimmed = safeDecodeURIComponent(String(rawSlug ?? '')).trim()
  if (!trimmed) return null
  const direct = LEGACY_POST_SLUGS[trimmed]
  if (direct) return direct
  const normalized = LEGACY_POST_SLUGS[normalizeArticleSlug(trimmed)]
  return normalized ?? null
}
