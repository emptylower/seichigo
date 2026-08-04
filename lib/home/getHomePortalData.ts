import { getAllAnime, type Anime } from '@/lib/anime/getAllAnime'
import { getCityCountsByLocale } from '@/lib/city/getCityCountsByLocale'
import { normalizeCityAlias } from '@/lib/city/normalize'
import { getLocalizedDisplayName, normalizeDisplayNameKey } from '@/lib/i18n/displayName'
import type { SupportedLocale } from '@/lib/i18n/types'
import { getAllPublicPosts } from '@/lib/posts/getAllPublicPosts'
import { isSeoSpokePost } from '@/lib/posts/visibility'
import type { PublicPostListItem } from '@/lib/posts/types'
import type { HomeHeroItem, HomePopularAnimeItem, HomePortalData, HomeStarterItem } from './types'

const STATIC_FALLBACK_COVERS = [
  'https://images.unsplash.com/photo-1542931287-023b922fa89b?q=80&w=600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?q=80&w=600&auto=format&fit=crop',
  'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?q=80&w=600&auto=format&fit=crop',
]

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

const HOME_DATA_TIMEOUT_MS = 8_000

type CityCountData = Awaited<ReturnType<typeof getCityCountsByLocale>>

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
    heroDisplay.push({ src: STATIC_FALLBACK_COVERS[heroDisplay.length % 3] })
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

    return {
      ...post,
      localizedAnimeNames,
      localizedCity: city ? getLocalizedDisplayName(city, locale) : post.city,
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

async function withTimeout<T>(label: string, task: Promise<T>, fallback: T): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => {
      console.warn(`[home] ${label} timed out after ${HOME_DATA_TIMEOUT_MS}ms`)
      resolve(fallback)
    }, HOME_DATA_TIMEOUT_MS)
  })

  try {
    return await Promise.race([task, timeout])
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

  const [posts, animeList, cityData] = await Promise.all([
    withTimeout(
      'getAllPublicPosts',
      effectiveDeps.getAllPublicPosts(locale).catch(() => []),
      [] as PublicPostListItem[]
    ),
    withTimeout(
      'getAllAnime',
      effectiveDeps.getAllAnime().catch(() => []),
      [] as Anime[]
    ),
    withTimeout(
      'getCityCountsByLocale',
      effectiveDeps.getCityCountsByLocale(locale).catch(() => ({ cities: [], counts: {} })),
      { cities: [], counts: {} } as CityCountData
    ),
  ])

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
