import { getAllAnimeForHome, type Anime } from '@/lib/anime/getAllAnime'
import { getCityCountsByLocaleForHome } from '@/lib/city/getCityCountsByLocale'
import { normalizeCityAlias } from '@/lib/city/normalize'
import {
  HomeDataSourceError,
  HomePortalDataUnavailableError,
  toHomeDataSourceError,
} from '@/lib/home/dataSourceError'
import { getHomeStats } from '@/lib/home/getHomeStats'
import { orderGuides } from '@/lib/home/guidesOrder'
import { readHomeHeroDemoFile, readHomeMapClustersFile, readHomeShowcaseFile } from '@/lib/home/generatedHomeFiles'
import { getLocalizedDisplayName, normalizeDisplayNameKey } from '@/lib/i18n/displayName'
import type { SupportedLocale } from '@/lib/i18n/types'
import { getAllPublicPostsForHome } from '@/lib/posts/getAllPublicPosts'
import { isSeoSpokePost } from '@/lib/posts/visibility'
import type { PublicPostListItem } from '@/lib/posts/types'
import type {
  HomeHeroDemo,
  HomeMapClusters,
  HomePopularAnimeItem,
  HomePortalData,
  HomeShowcase,
  HomeStats,
} from './types'

type HomeDataDeps = {
  getAllPublicPosts: typeof getAllPublicPostsForHome
  getAllAnime: typeof getAllAnimeForHome
  getCityCountsByLocale: typeof getCityCountsByLocaleForHome
  getHomeStats: (locale: SupportedLocale) => Promise<HomeStats>
  readHomeShowcase: () => Promise<HomeShowcase>
  readHomeMapClusters: () => Promise<HomeMapClusters>
  readHomeHeroDemo: () => Promise<HomeHeroDemo>
}

export const HOME_DATA_TIMEOUT_MS = 15_000
const TAG_COMPOSITE_SEPARATOR_RE = /(·|・|,|，|、|\/|&|／|\||｜|\s|\(|\)|\[|\]|（|）)+/

type CityCountData = Awaited<ReturnType<typeof getCityCountsByLocaleForHome>>
type HomeDataResult<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: HomeDataSourceError }

function localizedAnimeName(anime: Anime, locale: SupportedLocale): string {
  return getLocalizedDisplayName(anime, locale)
}

function localizedCityName(
  city: CityCountData['cities'][number],
  locale: SupportedLocale
): string {
  return getLocalizedDisplayName(city, locale)
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
  source: string,
  load: () => Promise<T>
): Promise<HomeDataResult<T>> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const reason = new Error(`${source} exceeded ${HOME_DATA_TIMEOUT_MS}ms`)
      reject(new HomeDataSourceError(source, 'timeout', reason))
    }, HOME_DATA_TIMEOUT_MS)
  })

  try {
    const value = await Promise.race([Promise.resolve().then(load), timeout])
    return { status: 'fulfilled', value }
  } catch (reason) {
    return { status: 'rejected', reason: toHomeDataSourceError(source, 'failure', reason) }
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

/** 攻略段：全部公开文章按 path 去重后交给 orderGuides（置顶作品优先，其余按 routeLength/cover 优先） */
function buildGuides(posts: PublicPostListItem[]): PublicPostListItem[] {
  const pool: PublicPostListItem[] = []
  for (const post of posts) {
    if (!pool.some((p) => p.path === post.path)) pool.push(post)
  }
  return orderGuides(pool)
}

/** 失败已在统一收集处抛出；这里只做收窄（不可达的 defensive throw） */
function unwrapHomeResult<T>(result: HomeDataResult<T>): T {
  if (result.status === 'rejected') {
    throw new Error('unreachable: home data failure was not rethrown')
  }
  return result.value
}

export async function getHomePortalData(
  locale: SupportedLocale,
  deps: Partial<HomeDataDeps> = {}
): Promise<HomePortalData> {
  const effectiveDeps: HomeDataDeps = {
    getAllPublicPosts: getAllPublicPostsForHome,
    getAllAnime: getAllAnimeForHome,
    getCityCountsByLocale: getCityCountsByLocaleForHome,
    getHomeStats,
    readHomeShowcase: async () => readHomeShowcaseFile(),
    readHomeMapClusters: async () => readHomeMapClustersFile(),
    readHomeHeroDemo: async () => readHomeHeroDemoFile(),
    ...deps,
  }

  const [postsResult, animeResult, cityResult, statsResult, showcaseResult, mapClustersResult, heroDemoResult] =
    await Promise.all([
      loadHomeDataSource(
        'posts.aggregate',
        () => effectiveDeps.getAllPublicPosts(locale)
      ),
      loadHomeDataSource(
        'anime.aggregate',
        () => effectiveDeps.getAllAnime()
      ),
      loadHomeDataSource(
        'city.aggregate',
        () => effectiveDeps.getCityCountsByLocale(locale)
      ),
      loadHomeDataSource(
        'home.stats',
        () => effectiveDeps.getHomeStats(locale)
      ),
      loadHomeDataSource(
        'home.showcase',
        () => effectiveDeps.readHomeShowcase()
      ),
      loadHomeDataSource(
        'home.mapClusters',
        () => effectiveDeps.readHomeMapClusters()
      ),
      loadHomeDataSource(
        'home.heroDemo',
        () => effectiveDeps.readHomeHeroDemo()
      ),
    ])

  const failures = [
    postsResult,
    animeResult,
    cityResult,
    statsResult,
    showcaseResult,
    mapClustersResult,
    heroDemoResult,
  ]
    .filter((result): result is { status: 'rejected'; reason: HomeDataSourceError } => result.status === 'rejected')
    .map((result) => result.reason)

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(
        `[home:data-source-error] locale=${locale} source=${failure.source} kind=${failure.kind}`,
        failure.reason
      )
    }
    throw new HomePortalDataUnavailableError(locale, failures)
  }

  const posts = unwrapHomeResult(postsResult)
  const animeList = unwrapHomeResult(animeResult)
  const cityData = unwrapHomeResult(cityResult)
  const stats = unwrapHomeResult(statsResult)
  const showcase = unwrapHomeResult(showcaseResult)
  const mapClusters = unwrapHomeResult(mapClustersResult)
  const heroDemo = unwrapHomeResult(heroDemoResult)

  const visiblePosts = posts.filter((p) => !isSeoSpokePost(p))
  const localizedPosts = localizePostListItems(visiblePosts, animeList, cityData.cities, locale)

  const featured = localizedPosts[0] || null
  const latestShelf = localizedPosts.slice(0, 12)

  return {
    featured,
    latestShelf,
    popularAnime: buildPopularAnime(animeList, visiblePosts, locale),
    popularCities: buildPopularCities(cityData, locale),
    stats,
    showcase,
    mapClusters,
    heroDemo,
    guides: buildGuides(localizedPosts),
  }
}
