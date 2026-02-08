import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import RouteDirectory from '@/components/resources/RouteDirectory'
import type { ResourceAnimeGroup } from '@/lib/resources/types'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('@/components/resources/ResourcesDeepLinkRuntime', () => ({
  default: () => null,
}))

const mockGroups: ResourceAnimeGroup[] = [
  {
    animeId: 'demo-anime',
    animeName: 'Demo Anime',
    cover: null,
    routeCount: 1,
    routes: [
      {
        routeKey: 'demo-article::route-1',
        routeAnchorId: 'route-demo-1',
        articleSlug: 'demo-article',
        articleTitle: 'Demo Article',
        animeIds: ['demo-anime'],
        city: '东京',
        routeId: 'route-1',
        routeTitle: '示例路线',
        route: {
          version: 1,
          title: '示例路线',
          spots: [{ name: 'Spot A', lat: 35.6895, lng: 139.6917 }],
        },
        previewSpots: [
          {
            order: 1,
            spotKey: 'spot-a',
            label: 'Spot A',
            name: 'Spot A',
            lat: 35.6895,
            lng: 139.6917,
          },
        ],
        spots: [
          {
            order: 1,
            spotKey: 'spot-a',
            label: 'Spot A',
            name: 'Spot A',
            nearestStation_zh: '站点 A',
            animeScene: '01:00',
            photoTip: '白天拍摄',
            lat: 35.6895,
            lng: 139.6917,
          },
        ],
      },
    ],
  },
]

describe('RouteDirectory', () => {
  it('keeps summary free of interactive links/buttons', () => {
    const { container } = render(<RouteDirectory groups={mockGroups} locale="zh" />)
    const summaries = Array.from(container.querySelectorAll('details summary'))

    expect(summaries.length).toBeGreaterThan(0)
    for (const summary of summaries) {
      expect(summary.querySelector('a, button')).toBeNull()
    }
  })

  it('renders route action links outside summary', () => {
    render(<RouteDirectory groups={mockGroups} locale="zh" />)

    const readOriginal = screen.getByRole('link', { name: '阅读原文' })
    const openMap = screen.getByRole('link', { name: '打开地图' })

    expect(readOriginal.closest('summary')).toBeNull()
    expect(openMap.closest('summary')).toBeNull()
    expect(readOriginal).toHaveAttribute('data-nav-surface', 'resources-card-actions')
    expect(openMap).toHaveAttribute('data-nav-surface', 'resources-card-actions')
  })
})
