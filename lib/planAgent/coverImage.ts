import { prisma } from '@/lib/db/prisma'

/**
 * 作品封面解析（M3）：ask 卡片与行程条目共用同一条封面来源阶梯，
 * 不在 UI 里另立第二套图片 URL 策略（展示走 /map 已有的候选梯 + 代理）。
 *
 * 阶梯（docs/superpowers/plans/2026-09-01-plan-agent-m3-interaction-upgrade.md §4）：
 *  1. 站内 Anitabi 作品封面（AnitabiBangumi.cover）
 *  2. 站内作品映射封面（AnitabiMapping → Anime.cover）
 *  3. 外部兜底：bgm.tv 条目封面（lain.bgm.tv 是图片代理白名单 host）
 *
 * 全程不含任何 API key；返回可直连/可代理的展示 URL + 来源溯源字段。
 */

export type WorkCover = {
  image: string
  source: 'anitabi' | 'anime' | 'bgm'
  /** 稳定来源标识或 URL */
  sourceUrl: string | null
  fetchedAt: string
  attribution: string | null
}

export type WorkCoverLookup = {
  /** bangumiId → AnitabiBangumi.cover */
  getAnitabiCover(bangumiId: number): Promise<string | null>
  /** bangumiId → AnitabiMapping 关联的 Anime.cover */
  getMappedAnimeCover(bangumiId: number): Promise<string | null>
  /** bgmSubjectId → 条目封面（外部兜底，需要网络调用） */
  getBgmSubjectCover(bgmSubjectId: number): Promise<string | null>
}

export function isDisplayableImageUrl(raw: string | null | undefined): raw is string {
  if (typeof raw !== 'string') return false
  const value = raw.trim()
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function createDefaultWorkCoverLookup(): WorkCoverLookup {
  // bgm.tv 条目封面的进程级小缓存（同一 subject 反复出现时不重复外呼）
  const bgmCache = new Map<number, { url: string | null; expiresAt: number }>()
  const BGM_CACHE_TTL_MS = 60 * 60 * 1000

  return {
    async getAnitabiCover(bangumiId) {
      if (!Number.isFinite(bangumiId)) return null
      const row = await prisma.anitabiBangumi.findUnique({
        where: { id: Math.floor(bangumiId) },
        select: { cover: true },
      })
      return isDisplayableImageUrl(row?.cover) ? row.cover : null
    },
    async getMappedAnimeCover(bangumiId) {
      if (!Number.isFinite(bangumiId)) return null
      const rows = await prisma.anitabiMapping.findMany({
        where: { bangumiId: Math.floor(bangumiId), anime: { hidden: false } },
        select: { anime: { select: { cover: true } } },
        take: 3,
      })
      for (const row of rows) {
        if (isDisplayableImageUrl(row.anime?.cover)) return row.anime.cover
      }
      return null
    },
    async getBgmSubjectCover(bgmSubjectId) {
      if (!Number.isFinite(bgmSubjectId)) return null
      const id = Math.floor(bgmSubjectId)
      const cached = bgmCache.get(id)
      if (cached && Date.now() < cached.expiresAt) return cached.url
      let url: string | null = null
      try {
        const res = await fetch(`https://api.bgm.tv/subject/${id}`, {
          headers: { 'User-Agent': 'seichigo/1.0 (https://seichigo.com)' },
          signal: AbortSignal.timeout(6_000),
        })
        if (res.ok) {
          const body = (await res.json().catch(() => null)) as { images?: { large?: string; common?: string } } | null
          const candidate = body?.images?.large ?? body?.images?.common ?? null
          url = isDisplayableImageUrl(candidate) ? candidate : null
        }
      } catch {
        url = null
      }
      bgmCache.set(id, { url, expiresAt: Date.now() + BGM_CACHE_TTL_MS })
      if (bgmCache.size > 100) {
        const oldest = bgmCache.keys().next().value
        if (oldest !== undefined) bgmCache.delete(oldest)
      }
      return url
    },
  }
}

export type ResolveWorkCoverInput = {
  bangumiId?: number
  bgmSubjectId?: number
}

/**
 * 按阶梯解析作品封面。任何一级失败都静默降级到下一级；全部失败返回 null
 * （调用方保留原有占位渲染，绝不编造封面）。
 */
export async function resolveWorkCover(
  input: ResolveWorkCoverInput,
  lookup: WorkCoverLookup,
): Promise<WorkCover | null> {
  const bangumiId = Number(input.bangumiId)
  const fetchedAt = new Date().toISOString()

  if (Number.isFinite(bangumiId)) {
    const anitabiCover = await lookup.getAnitabiCover(bangumiId).catch(() => null)
    if (isDisplayableImageUrl(anitabiCover)) {
      return { image: anitabiCover, source: 'anitabi', sourceUrl: `anitabi:bangumi:${bangumiId}`, fetchedAt, attribution: 'Anitabi' }
    }
    const animeCover = await lookup.getMappedAnimeCover(bangumiId).catch(() => null)
    if (isDisplayableImageUrl(animeCover)) {
      return { image: animeCover, source: 'anime', sourceUrl: `anime:bangumi:${bangumiId}`, fetchedAt, attribution: null }
    }
  }

  const bgmSubjectId = Number(input.bgmSubjectId)
  if (Number.isFinite(bgmSubjectId)) {
    const bgmCover = await lookup.getBgmSubjectCover(bgmSubjectId).catch(() => null)
    if (isDisplayableImageUrl(bgmCover)) {
      return {
        image: bgmCover,
        source: 'bgm',
        sourceUrl: `https://bgm.tv/subject/${Math.floor(bgmSubjectId)}`,
        fetchedAt,
        attribution: 'Bangumi',
      }
    }
  }

  return null
}
