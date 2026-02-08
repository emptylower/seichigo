import { getAllAnime, type Anime } from '@/lib/anime/getAllAnime'
import { getCityCountsByLocale } from '@/lib/city/getCityCountsByLocale'
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

type CityCountData = Awaited<ReturnType<typeof getCityCountsByLocale>>

function normalizeAnimeKey(input: string): string {
  return String(input || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
}

function localizedAnimeName(anime: Anime, locale: SupportedLocale): string {
  if (locale === 'en' && anime.name_en) return anime.name_en
  if (locale === 'ja' && anime.name_ja) return anime.name_ja
  return anime.name
}

function localizedCityName(
  city: CityCountData['cities'][number],
  locale: SupportedLocale
): string {
  if (locale === 'en') return city.name_en || city.name_zh
  if (locale === 'ja') return city.name_ja || city.name_en || city.name_zh
  return city.name_zh
}

function buildHeroDisplay(animeList: Anime[]): HomeHeroItem[] {
  const heroDisplay: HomeHeroItem[] = animeList
    .filter((a) => a.cover)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3)
    .map((a) => ({ src: a.cover!, name: a.name }))

  while (heroDisplay.length < 3) {
    heroDisplay.push({ src: STATIC_FALLBACK_COVERS[heroDisplay.length % 3] })
  }
  return heroDisplay
}

function buildAnimeKeyToIdMap(animeList: Anime[]): Map<string, string> {
  const keyToAnimeId = new Map<string, string>()
  const add = (key: string, animeId: string) => {
    const norm = normalizeAnimeKey(key)
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
      const mappedId = keyToAnimeId.get(normalizeAnimeKey(rawAnimeId))
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
    effectiveDeps.getAllPublicPosts(locale).catch(() => []),
    effectiveDeps.getAllAnime().catch(() => []),
    effectiveDeps.getCityCountsByLocale(locale).catch(() => ({ cities: [], counts: {} })),
  ])

  const visiblePosts = posts.filter((p) => !isSeoSpokePost(p))

  return {
    featured: visiblePosts[0] || null,
    latestShelf: visiblePosts.slice(0, 12),
    more: visiblePosts.slice(12, 24),
    heroDisplay: buildHeroDisplay(animeList),
    starterSteps: HOME_STARTER_STEPS,
    popularAnime: buildPopularAnime(animeList, visiblePosts, locale),
    popularCities: buildPopularCities(cityData, locale),
  }
}
