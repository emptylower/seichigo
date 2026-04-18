import animeRecords from '@/content/generated/public-anime.json'
import type { Anime } from './getAllAnime'

function cloneAnime(anime: Anime): Anime {
  return {
    ...anime,
    alias: anime.alias ? [...anime.alias] : undefined,
  }
}

export function getBundledAnimeList(): Anime[] {
  return (animeRecords as Anime[]).map((anime) => cloneAnime(anime))
}

export function getBundledAnimeById(id: string): Anime | null {
  const key = String(id || '').trim()
  if (!key) return null
  const found = (animeRecords as Anime[]).find((anime) => anime.id === key)
  return found ? cloneAnime(found) : null
}
