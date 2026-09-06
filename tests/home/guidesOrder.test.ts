import { describe, expect, it } from 'vitest'
import { HOME_GUIDES_PINNED_WORKS, HOME_GUIDES_TOTAL, orderGuides } from '@/lib/home/guidesOrder'
import type { PublicPostListItem } from '@/lib/posts/types'

function makePost(overrides: Partial<PublicPostListItem> = {}): PublicPostListItem {
  return {
    source: 'mdx',
    path: '/posts/default',
    title: 'default',
    animeIds: [],
    city: '',
    tags: [],
    ...overrides,
  }
}

describe('HOME_GUIDES_PINNED_WORKS', () => {
  it('pins Your Name across zh/en/ja spellings', () => {
    expect(HOME_GUIDES_PINNED_WORKS).toEqual(['你的名字', 'your name', '君の名は'])
  })

  it('caps the guides shelf at 8 entries', () => {
    expect(HOME_GUIDES_TOTAL).toBe(8)
  })
})

describe('orderGuides', () => {
  it('places all pinned-work guides first, then fills to 8 with one guide per distinct work', () => {
    const posts = [
      makePost({
        path: '/posts/h-bare-1',
        title: '北宇治日常',
        localizedAnimeNames: ['吹响！上低音号'],
        publishDate: '2026-05-01',
      }),
      makePost({
        path: '/posts/pin-en',
        title: 'tokyo days',
        localizedAnimeNames: ['Weathering With You', 'Your Name.'],
        publishedAt: '2026-03-02T08:00:00Z',
      }),
      makePost({
        path: '/posts/suzume',
        title: 'suzume trip',
        localizedAnimeNames: ['铃芽之旅'],
        publishDate: '2026-02-20',
      }),
      makePost({
        path: '/posts/h-both-1',
        title: '宇治桥漫步',
        localizedAnimeNames: ['吹响！上低音号'],
        routeLength: '3 天',
        cover: '/h1.png',
        publishDate: '2026-01-10',
      }),
      makePost({
        path: '/posts/pin-ja',
        title: '飛騨古川巡礼記録',
        localizedAnimeNames: ['君の名は。'],
        publishDate: '2026-02-10',
      }),
      makePost({
        path: '/posts/camp',
        title: 'camp trip',
        animeIds: ['摇曳露营△'],
        publishDate: '2026-04-05',
      }),
      makePost({ path: '/posts/slamdunk-title', title: '《灌篮高手》湘北巡礼', publishDate: '2026-03-10' }),
      makePost({
        path: '/posts/h-len',
        title: '大吉山夜逃',
        animeIds: ['吹响！上低音号'],
        routeLength: '2 天',
        publishDate: '2026-04-01',
      }),
      makePost({ path: '/posts/bocchi-title', title: '『孤独摇滚！』下北泽巡礼', publishDate: '2026-01-15' }),
      makePost({ path: '/posts/pin-zh', title: '諏訪湖巡礼', animeIds: ['你的名字'], publishDate: '2026-01-05' }),
      makePost({
        path: '/posts/h-cover',
        title: '植物园一幕',
        localizedAnimeNames: ['吹响！上低音号'],
        cover: '/hc.png',
        publishDate: '2026-02-01',
      }),
      makePost({
        path: '/posts/h-bare-2',
        title: '湖畔练习',
        localizedAnimeNames: ['吹响！上低音号'],
        publishDate: '2026-04-15',
      }),
      makePost({
        path: '/posts/h-both-2',
        title: '京都府立大学',
        localizedAnimeNames: ['吹响！上低音号'],
        routeLength: '2 天',
        cover: '/h2.png',
        publishDate: '2026-03-05',
      }),
    ]

    const guides = orderGuides(posts)

    expect(guides).toHaveLength(8)
    expect(guides.slice(0, 3).map((p) => p.path)).toEqual([
      '/posts/pin-en',
      '/posts/pin-ja',
      '/posts/pin-zh',
    ])
    expect(guides.slice(3).map((p) => p.path)).toEqual([
      '/posts/h-both-2',
      '/posts/camp',
      '/posts/slamdunk-title',
      '/posts/suzume',
      '/posts/bocchi-title',
    ])

    const workOf: Record<string, string> = {
      '/posts/h-both-2': 'hibike',
      '/posts/camp': 'camp',
      '/posts/slamdunk-title': 'slamdunk',
      '/posts/suzume': 'suzume',
      '/posts/bocchi-title': 'bocchi',
    }
    expect(new Set(guides.slice(3).map((p) => workOf[p.path])).size).toBe(5)
    expect(guides.filter((p) => p.path.startsWith('/posts/h-')).length).toBe(1)
  })

  it('starts a second round per work when there are not enough distinct works', () => {
    const posts = [
      makePost({ path: '/posts/b1', title: 'b1', localizedAnimeNames: ['孤独摇滚！'], publishDate: '2026-01-01' }),
      makePost({
        path: '/posts/pin',
        title: '你的名字巡礼',
        localizedAnimeNames: ['你的名字。'],
        publishDate: '2026-05-01',
      }),
      makePost({ path: '/posts/d1', title: '《灌篮高手》d1', publishDate: '2026-03-15' }),
      makePost({ path: '/posts/b2', title: 'b2', localizedAnimeNames: ['孤独摇滚！'], publishDate: '2026-02-01' }),
      makePost({ path: '/posts/d2', title: '《灌篮高手》d2', publishDate: '2026-04-01' }),
      makePost({ path: '/posts/pin-2', title: '諏訪湖', animeIds: ['你的名字'], publishDate: '2026-04-20' }),
      makePost({ path: '/posts/b3', title: 'b3', localizedAnimeNames: ['孤独摇滚！'], publishDate: '2026-03-01' }),
      makePost({ path: '/posts/pin-3', title: '飛騨', localizedAnimeNames: ['君の名は。'], publishDate: '2026-03-20' }),
    ]

    const guides = orderGuides(posts)

    expect(guides).toHaveLength(8)
    expect(guides.slice(0, 3).map((p) => p.path)).toEqual([
      '/posts/pin',
      '/posts/pin-2',
      '/posts/pin-3',
    ])
    expect(guides.slice(3).map((p) => p.path)).toEqual([
      '/posts/d2',
      '/posts/b3',
      '/posts/d1',
      '/posts/b2',
      '/posts/b1',
    ])
  })

  it('matches a pinned work mentioned in the title with full-width punctuation', () => {
    const posts = [
      makePost({ path: '/posts/strong', title: 'strong', routeLength: '3 天', cover: '/c.png' }),
      makePost({
        path: '/posts/title-pin',
        title: '《你的名字。》飞驒古川巡礼全记录',
        publishDate: '2025-12-01',
      }),
      makePost({ path: '/posts/other', title: '别的作品攻略', routeLength: '2 天', cover: '/c2.png' }),
    ]

    const guides = orderGuides(posts)

    expect(guides.map((p) => p.path)).toEqual(['/posts/title-pin', '/posts/strong', '/posts/other'])
  })

  it('groups work-less posts into one misc bucket and keeps taking rounds from it', () => {
    const posts = [
      makePost({ path: '/posts/misc-2', title: 'no work info 2', publishDate: '2026-02-01' }),
      makePost({ path: '/posts/misc-1', title: 'no work info 1', publishDate: '2026-03-01' }),
      makePost({
        path: '/posts/pin',
        title: '你的名字巡礼',
        localizedAnimeNames: ['你的名字。'],
        publishDate: '2026-01-01',
      }),
    ]

    const guides = orderGuides(posts)

    expect(guides.map((p) => p.path)).toEqual(['/posts/pin', '/posts/misc-1', '/posts/misc-2'])
  })
})
