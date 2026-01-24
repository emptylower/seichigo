import { describe, expect, it } from 'vitest'
import { extractResourceRoutesFromArticles, groupResourceRoutesByAnime, pickPreviewSpots, routeAnchorIdFor } from '@/lib/resources/aggregateRoutes'
import type { ResourceArticleForRoutes } from '@/lib/resources/types'

function makeRouteDoc(routeId: string, opts?: { title?: string; spots?: string[]; extraRoute?: boolean }) {
  const spots = (opts?.spots || ['A', 'B']).map((name_zh) => ({ name_zh }))
  const primary = { version: 1 as const, title: opts?.title, spots }
  const extra = { version: 1 as const, title: 'Extra', spots: [{ name_zh: 'X' }, { name_zh: 'Y' }] }
  return {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] },
      { type: 'seichiRoute', attrs: { id: routeId, data: primary } },
      ...(opts?.extraRoute ? [{ type: 'seichiRoute', attrs: { id: 'r-extra', data: extra } }] : []),
    ],
  }
}

describe('resources route aggregation', () => {
  it('extracts only the first route per article', () => {
    const articles: ResourceArticleForRoutes[] = [
      {
        slug: 'a-1',
        title: 'A1',
        animeIds: ['kimi'],
        city: 'Tokyo',
        contentJson: makeRouteDoc('r1', { title: 'Route 1', extraRoute: true }),
      },
      {
        slug: 'a-2',
        title: 'A2',
        animeIds: ['kimi'],
        city: 'Nagoya',
        contentJson: makeRouteDoc('r2', { title: 'Route 2', extraRoute: true }),
      },
    ]

    const routes = extractResourceRoutesFromArticles(articles)
    expect(routes).toHaveLength(2)
    expect(routes[0]!.routeId).toBe('r1')
    expect(routes[1]!.routeId).toBe('r2')
    expect(routes[0]!.routeTitle).toBe('Route 1')
  })

  it('samples preview spots and keeps endpoints', () => {
    const spots = Array.from({ length: 20 }, (_, i) => ({
      order: i + 1,
      spotKey: `k${i + 1}`,
      label: `S${i + 1}`,
    }))

    const preview = pickPreviewSpots(spots as any, 8)
    expect(preview).toHaveLength(8)
    expect(preview[0]!.order).toBe(1)
    expect(preview[preview.length - 1]!.order).toBe(20)
  })

  it('groups routes by animeIds (multi-anime appears in multiple groups)', () => {
    const routes = extractResourceRoutesFromArticles([
      {
        slug: 'a-1',
        title: 'A1',
        animeIds: ['kimi', 'btr'],
        contentJson: makeRouteDoc('r1', { title: 'R1' }),
      },
    ])

    const meta = new Map([
      ['kimi', { name: '你的名字', cover: null }],
      ['btr', { name: 'BTR', cover: null }],
    ])

    const groups = groupResourceRoutesByAnime(routes, meta)
    const ids = groups.map((g) => g.animeId).sort()
    expect(ids).toEqual(['btr', 'kimi'])
    expect(groups.find((g) => g.animeId === 'kimi')!.routes).toHaveLength(1)
    expect(groups.find((g) => g.animeId === 'btr')!.routes).toHaveLength(1)
  })

  it('produces stable anchor ids for a route key', () => {
    const a = routeAnchorIdFor('a-1::r1')
    const b = routeAnchorIdFor('a-1::r1')
    expect(a).toBe(b)
    expect(a).toMatch(/^route-/)
  })
})
