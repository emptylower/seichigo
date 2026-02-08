const ANIME_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_ANIME_ID_LENGTH = 64

function normalizeAliasKey(input: string): string {
  return String(input || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

const KNOWN_ALIAS_TO_ID = new Map<string, string>(
  [
    ['天气之子', 'weathering-with-you'],
    ['天気の子', 'weathering-with-you'],
    ['weathering with you', 'weathering-with-you'],
    ['轻音少女', 'k-on'],
    ['けいおん', 'k-on'],
    ['k on', 'k-on'],
    ['孤独摇滚', 'btr'],
    ['ぼっち・ざ・ろっく', 'btr'],
    ['bocchi the rock', 'btr'],
    ['吹响！上低音号', 'hibike'],
    ['響け！ユーフォニアム', 'hibike'],
    ['hibike euphonium', 'hibike'],
  ].map(([alias, id]) => [normalizeAliasKey(alias), id])
)

export function normalizeAnimeId(input: string): string {
  return String(input || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function isValidAnimeId(input: string): boolean {
  const id = normalizeAnimeId(input)
  if (!id) return false
  if (id.length > MAX_ANIME_ID_LENGTH) return false
  return ANIME_ID_RE.test(id)
}

function slugifyAscii(input: string): string {
  return String(input || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function resolveAnimeId(rawId: string, displayName: string): string | null {
  const aliasMatched =
    KNOWN_ALIAS_TO_ID.get(normalizeAliasKey(rawId)) ||
    KNOWN_ALIAS_TO_ID.get(normalizeAliasKey(displayName))
  if (aliasMatched) return aliasMatched

  const normalized = normalizeAnimeId(rawId)
  if (isValidAnimeId(normalized)) return normalized

  const fallback = slugifyAscii(displayName)
  if (isValidAnimeId(fallback)) return fallback

  return null
}
