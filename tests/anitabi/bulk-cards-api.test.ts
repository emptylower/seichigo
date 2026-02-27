import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    anitabiBangumi: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    anitabiSourceCursor: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: mocks.prisma,
}))

function jsonReq(url: string, method: string): Request {
  return new Request(url, { method })
}

describe('bulk cards api', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.DATABASE_URL = 'mock'
  })

  it('returns datasetVersion, items array, and total', async () => {
    mocks.prisma.anitabiBangumi.findMany.mockResolvedValue([
      {
        id: 1,
        title: 'Test Anime',
        titleZh: '测试动画',
        cat: 'TV',
        city: 'Tokyo',
        cover: 'https://example.com/cover.jpg',
        color: '#ff0000',
        pointsLength: 5,
        imagesLength: 10,
        sourceModifiedMs: 1234567890000,
        mapEnabled: true,
        geoLat: 35.6762,
        geoLng: 139.6503,
        zoom: 12,
        nearestDistanceMeters: null,
      },
    ])
    mocks.prisma.anitabiBangumi.count.mockResolvedValue(1)
    mocks.prisma.anitabiSourceCursor.findUnique.mockResolvedValue({
      sourceName: 'activeDatasetVersion',
      value: 'v1.0.0',
    })

    const handlers = await import('@/app/api/anitabi/bulk-cards/route')
    const res = await handlers.GET(jsonReq('http://localhost/api/anitabi/bulk-cards?locale=zh&tab=latest', 'GET'))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toHaveProperty('datasetVersion')
    expect(json).toHaveProperty('items')
    expect(json).toHaveProperty('total')
    expect(typeof json.datasetVersion).toBe('string')
    expect(Array.isArray(json.items)).toBe(true)
    expect(json.total).toBe(1)
  })

  it('items array contains AnitabiBangumiCard-shaped objects', async () => {
    mocks.prisma.anitabiBangumi.findMany.mockResolvedValue([
      {
        id: 2,
        title: 'Another Anime',
        titleZh: '另一个动画',
        cat: 'Movie',
        city: 'Osaka',
        cover: 'https://example.com/cover2.jpg',
        color: '#00ff00',
        pointsLength: 3,
        imagesLength: 7,
        sourceModifiedMs: 1234567890000,
        mapEnabled: true,
        geoLat: 34.6937,
        geoLng: 135.5023,
        zoom: 10,
        nearestDistanceMeters: 500,
      },
    ])
    mocks.prisma.anitabiBangumi.count.mockResolvedValue(1)
    mocks.prisma.anitabiSourceCursor.findUnique.mockResolvedValue({
      sourceName: 'activeDatasetVersion',
      value: 'v2.0.0',
    })

    const handlers = await import('@/app/api/anitabi/bulk-cards/route')
    const res = await handlers.GET(jsonReq('http://localhost/api/anitabi/bulk-cards?locale=zh&tab=hot', 'GET'))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.items.length).toBe(1)
    
    const card = json.items[0]
    expect(card).toHaveProperty('id')
    expect(card).toHaveProperty('title')
    expect(card).toHaveProperty('titleZh')
    expect(card).toHaveProperty('cat')
    expect(card).toHaveProperty('city')
    expect(card).toHaveProperty('cover')
    expect(card).toHaveProperty('color')
    expect(card).toHaveProperty('pointsLength')
    expect(card).toHaveProperty('imagesLength')
    expect(card).toHaveProperty('sourceModifiedMs')
    expect(card).toHaveProperty('mapEnabled')
    expect(card).toHaveProperty('geo')
    expect(card).toHaveProperty('zoom')
    expect(card).toHaveProperty('nearestDistanceMeters')
    
    expect(typeof card.id).toBe('number')
    expect(typeof card.title).toBe('string')
    expect(typeof card.pointsLength).toBe('number')
    expect(typeof card.imagesLength).toBe('number')
    expect(typeof card.mapEnabled).toBe('boolean')
    expect(Array.isArray(card.geo)).toBe(true)
    expect(card.geo.length).toBe(2)
  })

  it('returns 400 when tab=nearby', async () => {
    const handlers = await import('@/app/api/anitabi/bulk-cards/route')
    const res = await handlers.GET(jsonReq('http://localhost/api/anitabi/bulk-cards?locale=zh&tab=nearby', 'GET'))

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.toLowerCase()).toContain('nearby tab')
    expect(mocks.prisma.anitabiBangumi.findMany).not.toHaveBeenCalled()
  })

  it('response has correct Cache-Control header', async () => {
    mocks.prisma.anitabiBangumi.findMany.mockResolvedValue([])
    mocks.prisma.anitabiBangumi.count.mockResolvedValue(0)
    mocks.prisma.anitabiSourceCursor.findUnique.mockResolvedValue({
      sourceName: 'activeDatasetVersion',
      value: 'v3.0.0',
    })

    const handlers = await import('@/app/api/anitabi/bulk-cards/route')
    const res = await handlers.GET(jsonReq('http://localhost/api/anitabi/bulk-cards?locale=zh&tab=latest', 'GET'))

    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('public, s-maxage=300, stale-while-revalidate=3600')
  })
})
