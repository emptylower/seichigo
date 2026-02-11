import { describe, expect, it } from 'vitest'
import { normalizeBangumi, normalizeContributorsFromUsersRaw, normalizePoints } from '@/lib/anitabi/source/normalize'

describe('anitabi normalize', () => {
  it('normalizes bangumi core fields', () => {
    const row = normalizeBangumi({
      id: 293133,
      cn: '随兴旅',
      title: "ざつ旅",
      cat: '漫画系列',
      city: '日本',
      modified: 1770741911816,
      geo: [35.6, 139.7],
    })

    expect(row.id).toBe(293133)
    expect(row.titleZh).toBe('随兴旅')
    expect(row.titleJaRaw).toBe('ざつ旅')
    expect(row.city).toBe('日本')
    expect(row.sourceModifiedMs).toBe(BigInt(1770741911816))
    expect(row.geoLat).toBe(35.6)
    expect(row.geoLng).toBe(139.7)
  })

  it('merges point detail with summary fields', () => {
    const rows = normalizePoints(
      293133,
      [{ id: 'p1', name: '青梅駅', geo: [35.79, 139.25], ep: '1', origin: 'A' }],
      {
        points: [{ id: 'p1', density: 8, mark: 'test mark', folder: 'groupA', uid: 3 }],
      }
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.bangumiId).toBe(293133)
    expect(rows[0]?.density).toBe(8)
    expect(rows[0]?.mark).toBe('test mark')
    expect(rows[0]?.uid).toBe('3')
  })

  it('normalizes contributors from object payload', () => {
    const users = normalizeContributorsFromUsersRaw({
      u1: { name: 'Alice', avatar: 'a.png', link: 'https://x.dev' },
      u2: { nickname: 'Bob' },
    })

    expect(users).toHaveLength(2)
    expect(users[0]?.id).toBe('u1')
    expect(users[0]?.name).toBe('Alice')
  })
})
