import type { PublicPostListItem } from '@/lib/posts/types'

/** 首页攻略段置顶作品：大小写与标点不敏感的包含匹配 */
export const HOME_GUIDES_PINNED_WORKS = ['你的名字', 'your name', '君の名は'] as const

/** 攻略段总数上限（置顶 + 多样性填充） */
export const HOME_GUIDES_TOTAL = 8

/** 无法推导作品键的文章归入该组 */
const MISC_WORK_KEY = '_misc'

/** 归一化：去掉非字母数字字符（含全角句号、空格、连字符等）并小写 */
const PIN_IGNORE_RE = /[^\p{L}\p{N}]+/gu
const TITLE_WORK_RE = /[《『]([^》』]+)[》』]/

type IndexedPost = { post: PublicPostListItem; index: number }

function normalizePinKey(value: string): string {
  return value.toLowerCase().replace(PIN_IGNORE_RE, '')
}

function publishTime(post: PublicPostListItem): string {
  return post.publishedAt || post.publishDate || ''
}

function comparePublishTimeDesc(a: IndexedPost, b: IndexedPost): number {
  const aTime = publishTime(a.post)
  const bTime = publishTime(b.post)
  if (aTime !== bTime) return aTime < bTime ? 1 : -1
  return a.index - b.index
}

function isPinnedGuide(post: PublicPostListItem, pinnedKeys: string[]): boolean {
  const candidates = [post.title, ...(post.localizedAnimeNames || []), ...post.animeIds]
  for (const raw of candidates) {
    const key = normalizePinKey(String(raw || ''))
    if (key && pinnedKeys.some((pin) => key.includes(pin))) return true
  }
  return false
}

function hasRouteAndCover(post: PublicPostListItem): boolean {
  return Boolean(post.routeLength && post.cover)
}

function compareWithinWorkGroup(a: IndexedPost, b: IndexedPost): number {
  const aStrong = hasRouteAndCover(a.post)
  const bStrong = hasRouteAndCover(b.post)
  if (aStrong !== bStrong) return aStrong ? -1 : 1
  return comparePublishTimeDesc(a, b)
}

/** 作品键：localizedAnimeNames[0] → animeIds[0] → 标题里第一对《》/『』 → _misc */
function workKeyOf(post: PublicPostListItem): string {
  const name = post.localizedAnimeNames?.[0] || post.animeIds[0]
  if (name) return name
  const match = TITLE_WORK_RE.exec(post.title || '')
  if (match?.[1]) return match[1]
  return MISC_WORK_KEY
}

function groupNewestTime(group: IndexedPost[]): string {
  return group.reduce((newest, entry) => {
    const time = publishTime(entry.post)
    return time > newest ? time : newest
  }, '')
}

/**
 * 攻略段排序：
 * 1) 命中置顶作品的文章全部置顶，按发布时间倒序；
 * 2) 其余按作品分组，组内有 routeLength 且有 cover 的优先、再按发布时间倒序；
 *    组间按各组最新文章时间倒序轮转各取 1 篇，作品不足时进入下一轮；
 * 3) 总数（含置顶）填到 HOME_GUIDES_TOTAL 为止。
 */
export function orderGuides(
  posts: PublicPostListItem[],
  pinnedWorks: readonly string[] = HOME_GUIDES_PINNED_WORKS
): PublicPostListItem[] {
  const pinnedKeys = pinnedWorks.map(normalizePinKey).filter(Boolean)

  const flagged = posts.map((post, index) => ({
    post,
    index,
    pinned: isPinnedGuide(post, pinnedKeys),
  }))
  const pinned = flagged.filter((entry) => entry.pinned).sort(comparePublishTimeDesc)
  const rest: IndexedPost[] = flagged.filter((entry) => !entry.pinned)

  const groups = new Map<string, IndexedPost[]>()
  for (const entry of rest) {
    const key = workKeyOf(entry.post)
    const group = groups.get(key)
    if (group) group.push(entry)
    else groups.set(key, [entry])
  }

  const orderedGroups = [...groups.values()]
    .map((group) => group.sort(compareWithinWorkGroup))
    .sort((a, b) => {
      const aTime = groupNewestTime(a)
      const bTime = groupNewestTime(b)
      if (aTime !== bTime) return aTime < bTime ? 1 : -1
      return a[0].index - b[0].index
    })

  const result: PublicPostListItem[] = pinned.map(({ post }) => post)
  const cursors = orderedGroups.map(() => 0)
  while (result.length < HOME_GUIDES_TOTAL) {
    let took = false
    for (let g = 0; g < orderedGroups.length && result.length < HOME_GUIDES_TOTAL; g++) {
      const group = orderedGroups[g]
      if (cursors[g] >= group.length) continue
      result.push(group[cursors[g]].post)
      cursors[g] += 1
      took = true
    }
    if (!took) break
  }
  return result
}
