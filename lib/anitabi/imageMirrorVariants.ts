import { computeCanonicalImageUrl, isAnitabiPointImagePath, normalizeBgmApiRelayUrl } from '@/lib/anitabi/imageNormalize'

export type MirrorVariant = { label: string; url: string }

function tryParseAbsoluteHttpUrl(rawUrl: string | null | undefined): URL | null {
  const raw = String(rawUrl || '').trim()
  if (!raw) return null

  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }
    return url
  } catch {
    return null
  }
}

function isAnitabiHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'anitabi.cn' || host === 'www.anitabi.cn' || host.endsWith('.anitabi.cn')
}

function isBangumiHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'bgm.tv' || host.endsWith('.bgm.tv')
}

function buildCanonicalVariant(
  url: URL,
  label: string,
  mutate: (candidate: URL) => void,
): MirrorVariant | null {
  try {
    const candidate = new URL(url.toString())
    mutate(candidate)
    return {
      label,
      url: computeCanonicalImageUrl(candidate.toString()),
    }
  } catch {
    return null
  }
}

function normalizeCoverParams(url: URL): void {
  url.searchParams.delete('w')
  url.searchParams.delete('h')
  url.searchParams.delete('q')
}

function replaceBgmCoverSegment(pathname: string, size: 'l' | 'm'): string | null {
  if (pathname.includes('/pic/cover/l/')) {
    return pathname.replace('/pic/cover/l/', `/pic/cover/${size}/`)
  }
  if (pathname.includes('/pic/cover/m/')) {
    return pathname.replace('/pic/cover/m/', `/pic/cover/${size}/`)
  }
  return null
}

export function enumerateBangumiCoverVariants(rawUrl: string | null | undefined): MirrorVariant[] {
  const parsedInput = tryParseAbsoluteHttpUrl(rawUrl)
  if (!parsedInput) return []
  // bgm-api.anitabi.cn 命中 isAnitabiHost 的 endsWith 判断但并非 anitabi 图片 CDN，
  // 而是 Bangumi 封面中转 —— 先归一回 lain.bgm.tv 再走 bgm 分支枚举，
  // 保证 canonical / R2 key 与旧镜像零漂移。
  const parsed = normalizeBgmApiRelayUrl(parsedInput)

  try {
    if (isAnitabiHost(parsed.hostname)) {
      const normalizedPathname = parsed.pathname.startsWith('/images/')
        ? parsed.pathname.slice('/images'.length)
        : parsed.pathname
      if (!normalizedPathname.startsWith('/bangumi/')) {
        return []
      }

      const large = buildCanonicalVariant(parsed, 'cover-l', (candidate) => {
        normalizeCoverParams(candidate)
        candidate.searchParams.set('plan', 'l')
      })
      const medium = buildCanonicalVariant(parsed, 'cover-m', (candidate) => {
        normalizeCoverParams(candidate)
        candidate.searchParams.delete('plan')
      })
      // 2026-09-10：地图圆头像是封面图的最大消费场景，新增 h160 变体镜像
      // （8.6KB vs 原图最大 1.9MB）。只能是新增 key —— cover-l/cover-m 的
      // canonical 计算保持逐字节不变，8.5 万存量对象零漂移。
      const h160 = buildCanonicalVariant(parsed, 'cover-h160', (candidate) => {
        normalizeCoverParams(candidate)
        candidate.searchParams.set('plan', 'h160')
      })

      return large && medium && h160 ? [large, medium, h160] : []
    }

    if (!isBangumiHost(parsed.hostname)) {
      return []
    }

    const mediumPath = replaceBgmCoverSegment(parsed.pathname, 'm')
    if (!mediumPath) {
      return []
    }

    const medium = buildCanonicalVariant(parsed, 'cover-m', (candidate) => {
      candidate.pathname = mediumPath
    })

    return medium ? [medium] : []
  } catch {
    return []
  }
}

export function enumeratePointImageVariants(rawUrl: string | null | undefined): MirrorVariant[] {
  const parsed = tryParseAbsoluteHttpUrl(rawUrl)
  if (!parsed || !isAnitabiHost(parsed.hostname)) {
    return []
  }

  // h320 变体上游不存在（EdgeOne 404，2026-09 实证），彻底移除；只镜像 h160 与 w640q80。
  if (!isAnitabiPointImagePath(parsed.pathname)) {
    return []
  }

  const h160 = buildCanonicalVariant(parsed, 'h160', (candidate) => {
    candidate.searchParams.delete('w')
    candidate.searchParams.delete('h')
    candidate.searchParams.delete('q')
    candidate.searchParams.set('plan', 'h160')
  })
  const w640q80 = buildCanonicalVariant(parsed, 'w640q80', (candidate) => {
    candidate.searchParams.delete('plan')
    candidate.searchParams.delete('h')
    candidate.searchParams.set('w', '640')
    candidate.searchParams.set('q', '80')
  })

  return h160 && w640q80 ? [h160, w640q80] : []
}
