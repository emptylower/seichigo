import { getAllAnime, type Anime } from '@/lib/anime/getAllAnime'
import { getCityCountsByLocale } from '@/lib/city/getCityCountsByLocale'
import { normalizeCityAlias } from '@/lib/city/normalize'
import { getLocalizedDisplayName, normalizeDisplayNameKey } from '@/lib/i18n/displayName'
import type { SupportedLocale } from '@/lib/i18n/types'
import { getAllPublicPosts } from '@/lib/posts/getAllPublicPosts'
import { isSeoSpokePost } from '@/lib/posts/visibility'
import type { PublicPostListItem } from '@/lib/posts/types'
import type { HomeHeroItem, HomePopularAnimeItem, HomePortalData, HomeStarterItem } from './types'

const HOME_STARTER_STEPS: HomeStarterItem[] = [
  {
    id: 'anime',
    href: '/anime',
    titleKey: 'pages.home.starterStep1Title',
    descKey: 'pages.home.starterStep1Desc',
    ctaKey: 'pages.home.viewAllAnimeLinkAlt',
  },
  {
    id: 'city',
    href: '/city',
    titleKey: 'pages.home.starterStep2Title',
    descKey: 'pages.home.starterStep2Desc',
    ctaKey: 'pages.home.viewAllCityLink',
  },
  {
    id: 'resources',
    href: '/resources',
    titleKey: 'pages.home.starterStep3Title',
    descKey: 'pages.home.starterStep3Desc',
    ctaKey: 'header.resources',
  },
]

type HomeDataDeps = {
  getAllPublicPosts: typeof getAllPublicPosts
  getAllAnime: typeof getAllAnime
  getCityCountsByLocale: typeof getCityCountsByLocale
}

export const HOME_DATA_TIMEOUT_MS = 15_000
const TAG_COMPOSITE_SEPARATOR_RE = /(·|・|,|，|、|\/|&|／|\||｜|\s|\(|\)|\[|\]|（|）)+/

type CityCountData = Awaited<ReturnType<typeof getCityCountsByLocale>>
type HomeDataSource = keyof HomeDataDeps
type HomeDataFailure = { source: HomeDataSource; reason: unknown }

class HomePortalDataUnavailableError extends Error {
  constructor(readonly failures: HomeDataFailure[]) {
    super(`Required home data source failed: ${failures.map(({ source }) => source).join(', ')}`)
    this.name = 'HomePortalDataUnavailableError'
  }
}

function localizedAnimeName(anime: Anime, locale: SupportedLocale): string {
  return getLocalizedDisplayName(anime, locale)
}

function localizedCityName(
  city: CityCountData['cities'][number],
  locale: SupportedLocale
): string {
  return getLocalizedDisplayName(city, locale)
}

function buildHeroDisplay(animeList: Anime[], locale: SupportedLocale): HomeHeroItem[] {
  const heroDisplay: HomeHeroItem[] = animeList
    .filter((a) => a.cover)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3)
    .map((a) => ({ src: a.cover!, name: getLocalizedDisplayName(a, locale) }))

  while (heroDisplay.length < 3) {
    heroDisplay.push({ src: null })
  }
  return heroDisplay
}

function buildAnimeKeyToIdMap(animeList: Anime[]): Map<string, string> {
  const keyToAnimeId = new Map<string, string>()
  const add = (key: string, animeId: string) => {
    const norm = normalizeDisplayNameKey(key)
    if (!norm || keyToAnimeId.has(norm)) return
    keyToAnimeId.set(norm, animeId)
  }

  for (const anime of animeList) {
    add(anime.id, anime.id)
    add(anime.name, anime.id)
    if (anime.name_en) add(anime.name_en, anime.id)
    if (anime.name_ja) add(anime.name_ja, anime.id)
    for (const alias of anime.alias || []) add(alias, anime.id)
  }

  return keyToAnimeId
}

function buildAnimeKeyMap(animeList: Anime[]): Map<string, Anime> {
  const keyToAnime = new Map<string, Anime>()
  const add = (key: string, anime: Anime) => {
    const normalized = normalizeDisplayNameKey(key)
    if (!normalized || keyToAnime.has(normalized)) return
    keyToAnime.set(normalized, anime)
  }

  for (const anime of animeList) {
    add(anime.id, anime)
    add(anime.name, anime)
    add(anime.name_en || '', anime)
    add(anime.name_ja || '', anime)
    for (const alias of anime.alias || []) add(alias, anime)
  }

  return keyToAnime
}

function buildCityKeyMap(cityData: CityCountData['cities']): Map<string, CityCountData['cities'][number]> {
  const keyToCity = new Map<string, CityCountData['cities'][number]>()
  const add = (key: string, city: CityCountData['cities'][number]) => {
    const normalized = normalizeCityAlias(key)
    if (!normalized || keyToCity.has(normalized)) return
    keyToCity.set(normalized, city)
  }

  for (const city of cityData) {
    add(city.slug, city)
    add(city.name_zh, city)
    add(city.name_en || '', city)
    add(city.name_ja || '', city)
  }

  return keyToCity
}

function localizePostTag(
  rawTag: string,
  animeByKey: Map<string, Anime>,
  cityByKey: Map<string, CityCountData['cities'][number]>,
  locale: SupportedLocale
): string {
  const tag = String(rawTag || '')
  if (!tag.trim()) return tag

  const anime = animeByKey.get(normalizeDisplayNameKey(tag))
  if (anime) return getLocalizedDisplayName(anime, locale)

  const city = cityByKey.get(normalizeCityAlias(tag))
  if (city) return getLocalizedDisplayName(city, locale)

  return tag
    .split(TAG_COMPOSITE_SEPARATOR_RE)
    .map((part) => {
      if (!part || TAG_COMPOSITE_SEPARATOR_RE.test(part)) return part

      const partAnime = animeByKey.get(normalizeDisplayNameKey(part))
      if (partAnime) return getLocalizedDisplayName(partAnime, locale)

      const partCity = cityByKey.get(normalizeCityAlias(part))
      return partCity ? getLocalizedDisplayName(partCity, locale) : part
    })
    .join('')
}

function localizePostListItems(
  posts: PublicPostListItem[],
  animeList: Anime[],
  cities: CityCountData['cities'],
  locale: SupportedLocale
): PublicPostListItem[] {
  const animeByKey = buildAnimeKeyMap(animeList)
  const cityByKey = buildCityKeyMap(cities)

  return posts.map((post) => {
    const localizedAnimeNames = (post.animeIds || []).map((rawId) => {
      const anime = animeByKey.get(normalizeDisplayNameKey(rawId))
      return anime ? getLocalizedDisplayName(anime, locale) : rawId
    })
    const city = cityByKey.get(normalizeCityAlias(post.city))
    const localizedTags = (post.tags || []).map((tag) => localizePostTag(tag, animeByKey, cityByKey, locale))

    return {
      ...post,
      localizedAnimeNames,
      localizedCity: city ? getLocalizedDisplayName(city, locale) : post.city,
      localizedTags,
    }
  })
}

function buildPopularAnime(
  animeList: Anime[],
  posts: PublicPostListItem[],
  locale: SupportedLocale
): HomePopularAnimeItem[] {
  const keyToAnimeId = buildAnimeKeyToIdMap(animeList)
  const counts: Record<string, number> = {}
  const coverFallback = new Map<string, string>()

  for (const post of posts) {
    for (const rawAnimeId of post.animeIds || []) {
      const mappedId = keyToAnimeId.get(normalizeDisplayNameKey(rawAnimeId))
      if (!mappedId) continue
      counts[mappedId] = (counts[mappedId] || 0) + 1
      if (post.cover && !coverFallback.has(mappedId)) {
        coverFallback.set(mappedId, post.cover)
      }
    }
  }

  return animeList
    .map((anime) => ({
      anime,
      postCount: counts[anime.id] || 0,
      cover: anime.cover || coverFallback.get(anime.id) || null,
    }))
    .filter((item) => item.postCount > 0)
    .sort((a, b) => {
      if (a.postCount !== b.postCount) return b.postCount - a.postCount
      return localizedAnimeName(a.anime, locale).localeCompare(localizedAnimeName(b.anime, locale))
    })
    .slice(0, 6)
}

function buildPopularCities(cityData: CityCountData, locale: SupportedLocale): HomePortalData['popularCities'] {
  return cityData.cities
    .map((city) => ({ city, postCount: cityData.counts[city.id] || 0 }))
    .filter((item) => item.postCount > 0)
    .sort((a, b) => {
      if (a.postCount !== b.postCount) return b.postCount - a.postCount
      return localizedCityName(a.city, locale).localeCompare(localizedCityName(b.city, locale))
    })
    .slice(0, 6)
}

async function loadHomeDataSource<T>(
  source: HomeDataSource,
  load: () => Promise<T>
): Promise<PromiseSettledResult<T>> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${source} timed out after ${HOME_DATA_TIMEOUT_MS}ms`))
    }, HOME_DATA_TIMEOUT_MS)
  })

  try {
    const value = await Promise.race([Promise.resolve().then(load), timeout])
    return { status: 'fulfilled', value }
  } catch (reason) {
    return { status: 'rejected', reason }
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

export async function getHomePortalData(
  locale: SupportedLocale,
  deps: Partial<HomeDataDeps> = {}
): Promise<HomePortalData> {
  const effectiveDeps: HomeDataDeps = {
    getAllPublicPosts,
    getAllAnime,
    getCityCountsByLocale,
    ...deps,
  }

  const [postsResult, animeResult, cityResult] = await Promise.all([
    loadHomeDataSource(
      'getAllPublicPosts',
      () => effectiveDeps.getAllPublicPosts(locale)
    ),
    loadHomeDataSource(
      'getAllAnime',
      () => effectiveDeps.getAllAnime()
    ),
    loadHomeDataSource(
      'getCityCountsByLocale',
      () => effectiveDeps.getCityCountsByLocale(locale)
    ),
  ])

  if (
    postsResult.status === 'rejected'
    || animeResult.status === 'rejected'
    || cityResult.status === 'rejected'
  ) {
    const failures: HomeDataFailure[] = []
    if (postsResult.status === 'rejected') {
      failures.push({ source: 'getAllPublicPosts', reason: postsResult.reason })
    }
    if (animeResult.status === 'rejected') {
      failures.push({ source: 'getAllAnime', reason: animeResult.reason })
    }
    if (cityResult.status === 'rejected') {
      failures.push({ source: 'getCityCountsByLocale', reason: cityResult.reason })
    }

    console.error('[home] refusing to render degraded portal data', { locale, failures })
    throw new HomePortalDataUnavailableError(failures)
  }

  const posts = postsResult.value
  const animeList = animeResult.value
  const cityData = cityResult.value

  const visiblePosts = posts.filter((p) => !isSeoSpokePost(p))
  const localizedPosts = localizePostListItems(visiblePosts, animeList, cityData.cities, locale)

  return {
    featured: localizedPosts[0] || null,
    latestShelf: localizedPosts.slice(0, 12),
    more: localizedPosts.slice(12, 24),
    heroDisplay: buildHeroDisplay(animeList, locale),
    starterSteps: HOME_STARTER_STEPS,
    popularAnime: buildPopularAnime(animeList, visiblePosts, locale),
    popularCities: buildPopularCities(cityData, locale),
  }
}
