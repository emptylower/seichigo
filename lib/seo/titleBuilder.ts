/**
 * SEO title builder utilities for anime pilgrimage site
 * Returns { absolute: string } to bypass Next.js layout template suffix
 */

type Locale = 'zh' | 'en' | 'ja'

/**
 * Build SEO title for anime page
 * Format: {name} {keyword} | {cities}
 * Example ZH: "孤独摇滚 圣地巡礼攻略｜下北泽·江之岛"
 * Example EN: "Bocchi the Rock! Anime Pilgrimage Guide | Shimokitazawa"
 * Example JA: "ぼっち・ざ・ろっく 聖地巡礼ガイド｜下北沢"
 */
export function buildAnimeSeoTitle(
  anime: { name: string; name_en?: string | null; name_ja?: string | null },
  posts: Array<{ city?: string | null }>,
  locale: Locale
): { absolute: string } {
  // Select locale-specific name
  let animeName: string
  let hasLocaleName = true

  switch (locale) {
    case 'zh':
      animeName = anime.name
      break
    case 'en':
      if (anime.name_en == null) {
        hasLocaleName = false
        animeName = anime.name
      } else {
        animeName = anime.name_en
      }
      break
    case 'ja':
      if (anime.name_ja == null) {
        hasLocaleName = false
        animeName = anime.name
      } else {
        animeName = anime.name_ja
      }
      break
  }

  // NULL GUARD: if locale-specific name is missing, return name-only without keyword
  if (!hasLocaleName) {
    return { absolute: animeName }
  }

  // Extract unique cities from posts
  const cities = Array.from(
    new Set(
      posts
        .map((p) => p.city)
        .filter((c): c is string => c != null && c.trim() !== '')
    )
  ).slice(0, 2)

  // Build title based on locale
  let title: string
  const citySeparator = locale === 'en' ? ', ' : '·'
  const cityPart = cities.length > 0 ? cities.join(citySeparator) : ''

  switch (locale) {
    case 'zh':
      title = cityPart
        ? `${animeName} 圣地巡礼攻略｜${cityPart}`
        : `${animeName} 圣地巡礼攻略`
      break
    case 'en':
      title = cityPart
        ? `${animeName} Anime Pilgrimage Guide | ${cityPart}`
        : `${animeName} Anime Pilgrimage Guide`
      break
    case 'ja':
      title = cityPart
        ? `${animeName} 聖地巡礼ガイド｜${cityPart}`
        : `${animeName} 聖地巡礼ガイド`
      break
  }

  // Apply length guards
  const maxLength = locale === 'en' ? 60 : 30
  const charCount = [...title].length

  if (charCount > maxLength) {
    // First try: drop city suffix
    const titleWithoutCities =
      locale === 'zh'
        ? `${animeName} 圣地巡礼攻略`
        : locale === 'en'
          ? `${animeName} Anime Pilgrimage Guide`
          : `${animeName} 聖地巡礼ガイド`

    if ([...titleWithoutCities].length <= maxLength) {
      return { absolute: titleWithoutCities }
    }

    // Still too long: drop keyword suffix, return name only
    return { absolute: animeName }
  }

  return { absolute: title }
}

/**
 * Build SEO title for city page
 * Format: {city} {keyword} | {anime}
 * Example ZH: "下北泽 动漫圣地巡礼｜孤独摇滚"
 * Example EN: "Shimokitazawa Anime Pilgrimage | Bocchi the Rock!"
 * Example JA: "下北沢 アニメ聖地巡礼｜ぼっち・ざ・ろっく"
 */
export function buildCitySeoTitle(
  city: { name_zh: string; name_en?: string | null; name_ja?: string | null },
  relatedAnimeNames: string[],
  locale: Locale
): { absolute: string } {
  // Select locale-specific city name
  let cityName: string
  switch (locale) {
    case 'zh':
      cityName = city.name_zh
      break
    case 'en':
      cityName = city.name_en ?? city.name_zh
      break
    case 'ja':
      cityName = city.name_ja ?? city.name_zh
      break
  }

  // Take first 2 unique anime names
  const animeNames = Array.from(new Set(relatedAnimeNames)).slice(0, 2)
  const animeSeparator = locale === 'en' ? ', ' : '·'
  const animePart = animeNames.length > 0 ? animeNames.join(animeSeparator) : ''

  // Build title based on locale
  let title: string
  switch (locale) {
    case 'zh':
      title = animePart
        ? `${cityName} 动漫圣地巡礼｜${animePart}`
        : `${cityName} 动漫圣地巡礼`
      break
    case 'en':
      title = animePart
        ? `${cityName} Anime Pilgrimage | ${animePart}`
        : `${cityName} Anime Pilgrimage`
      break
    case 'ja':
      title = animePart
        ? `${cityName} アニメ聖地巡礼｜${animePart}`
        : `${cityName} アニメ聖地巡礼`
      break
  }

  // Apply length guards
  const maxLength = locale === 'en' ? 60 : 30
  const charCount = [...title].length

  if (charCount > maxLength) {
    // First try: drop anime suffix
    const titleWithoutAnime =
      locale === 'zh'
        ? `${cityName} 动漫圣地巡礼`
        : locale === 'en'
          ? `${cityName} Anime Pilgrimage`
          : `${cityName} アニメ聖地巡礼`

    if ([...titleWithoutAnime].length <= maxLength) {
      return { absolute: titleWithoutAnime }
    }

    // Still too long: drop keyword suffix, return city name only
    return { absolute: cityName }
  }

  return { absolute: title }
}

/**
 * Build fallback SEO title for post page
 * Format: {title} {keyword} | {city}
 * Example ZH: "下北泽车站前 圣地巡礼｜下北泽"
 * Example EN: "Shimokitazawa Station Anime Pilgrimage | Shimokitazawa"
 * Example JA: "下北沢駅前 聖地巡礼｜下北沢"
 */
export function buildPostFallbackTitle(
  title: string,
  _animeId: string | null | undefined,
  city: string | null | undefined,
  locale: Locale
): { absolute: string } {
  const cleanTitle = title.trim()
  const cleanCity = city?.trim()

  // Build title based on locale
  let result: string
  switch (locale) {
    case 'zh':
      result = cleanCity
        ? `${cleanTitle} 圣地巡礼｜${cleanCity}`
        : `${cleanTitle} 圣地巡礼`
      break
    case 'en':
      result = cleanCity
        ? `${cleanTitle} Anime Pilgrimage | ${cleanCity}`
        : `${cleanTitle} Anime Pilgrimage`
      break
    case 'ja':
      result = cleanCity
        ? `${cleanTitle} 聖地巡礼｜${cleanCity}`
        : `${cleanTitle} 聖地巡礼`
      break
  }

  // Apply length guards
  const maxLength = locale === 'en' ? 60 : 30
  const charCount = [...result].length

  if (charCount > maxLength) {
    // First try: drop city suffix
    const titleWithoutCity =
      locale === 'zh'
        ? `${cleanTitle} 圣地巡礼`
        : locale === 'en'
          ? `${cleanTitle} Anime Pilgrimage`
          : `${cleanTitle} 聖地巡礼`

    if ([...titleWithoutCity].length <= maxLength) {
      return { absolute: titleWithoutCity }
    }

    // Still too long: drop keyword suffix, return title only
    return { absolute: cleanTitle }
  }

  return { absolute: result }
}
