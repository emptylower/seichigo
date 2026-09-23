import type { SupportedLocale } from '@/lib/i18n/types'
import { t } from '@/lib/i18n'
import type { PageCardKind } from '@/lib/og/pageCardHtml'

export type PageCardContent = {
  title: string
  subtitle: string | null
  /** DB/MDX 原始 cover：可能是站内相对路径、R2 公共域或 anitabi 地址，由 handler 归一 */
  cover: string | null
}

function localizedAnimeName(
  anime: { name: string; name_en?: string; name_ja?: string } | null,
  locale: SupportedLocale,
  fallbackId: string,
): string {
  if (!anime) return fallbackId
  if (locale === 'en') return anime.name_en || anime.name
  if (locale === 'ja') return anime.name_ja || anime.name
  return anime.name
}

/** site/home：无 DB 依赖，文案全部来自 i18n（og.* 命名空间） */
function siteContent(locale: SupportedLocale): PageCardContent {
  return {
    title: t('og.siteTitle', locale),
    subtitle: t('og.siteSubtitle', locale),
    cover: null,
  }
}

/**
 * 内容查找：与各页面 generateMetadata 取标题/封面走同一套函数，
 * 保证 OG 卡片与页面标题不漂移。任何一环抛错按 not_found 处理（走兜底图）。
 */
export async function loadPageCardContent(
  kind: PageCardKind,
  id: string,
  locale: SupportedLocale,
): Promise<PageCardContent | null> {
  try {
    if (kind === 'site') {
      return id === 'home' ? siteContent(locale) : null
    }
    if (kind === 'post') {
      const { getPublicPostBySlug } = await import('@/lib/posts/getPublicPostBySlug')
      const { getAnimeById } = await import('@/lib/anime/getAllAnime')
      const found = await getPublicPostBySlug(id, locale)
      if (!found) return null
      const title =
        found.source === 'mdx' ? found.post.frontmatter.title : found.article.title
      const cover =
        found.source === 'mdx'
          ? String(found.post.frontmatter.cover || '') || null
          : found.article.cover || null
      const animeId =
        found.source === 'mdx'
          ? found.post.frontmatter.animeId
          : found.article.animeIds?.[0] || ''
      const city =
        found.source === 'mdx' ? found.post.frontmatter.city : found.article.city || ''
      const anime = animeId ? await getAnimeById(animeId).catch(() => null) : null
      const subtitle = [localizedAnimeName(anime, locale, animeId), String(city || '').trim()]
        .filter(Boolean)
        .join(' · ')
      return { title: String(title || '').trim(), subtitle: subtitle || null, cover }
    }
    if (kind === 'anime') {
      const { getAnimeById } = await import('@/lib/anime/getAllAnime')
      const anime = await getAnimeById(id)
      if (!anime) return null
      const summary =
        locale === 'en'
          ? anime.summary_en || anime.summary
          : locale === 'ja'
            ? anime.summary_ja || anime.summary
            : anime.summary
      return {
        title: localizedAnimeName(anime, locale, id),
        subtitle: String(summary || '').trim() || null,
        cover: anime.cover || null,
      }
    }
    const { getCityBySlugOrRedirect } = await import('@/lib/city/db')
    const { city } = await getCityBySlugOrRedirect(id)
    if (!city) return null
    const name =
      locale === 'en'
        ? city.name_en || city.name_zh
        : locale === 'ja'
          ? city.name_ja || city.name_zh
          : city.name_zh
    const description =
      locale === 'en'
        ? city.description_en || city.description_zh
        : locale === 'ja'
          ? city.description_ja || city.description_zh
          : city.description_zh
    return {
      title: name,
      subtitle: String(description || '').trim() || null,
      cover: city.cover || null,
    }
  } catch (error) {
    // 内容查找失败不能抛穿：OG 路径永不 500，按 not_found 走兜底
    console.error('[og.page_card.content_failed]', { kind, id, locale, error })
    return null
  }
}
