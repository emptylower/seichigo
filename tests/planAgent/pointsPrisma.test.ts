import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/db/prisma', () => {
  const findMany = vi.fn(async () => [])
  return { prisma: { anitabiPoint: { findMany } } }
})

import { prisma } from '@/lib/db/prisma'
import { PrismaPointFinder } from '@/lib/planAgent/pointsPrisma'

const findMany = prisma.anitabiPoint.findMany as unknown as Mock

// 模拟库里的点位表：id 都是 "<bangumiId>:<rawId>" 的 scoped 形式
const DB_ROWS: Record<string, { id: string; geoLat: number; geoLng: number }> = {
  '115908:p1': { id: '115908:p1', geoLat: 34.8892, geoLng: 135.8075 },
  '115908:p2': { id: '115908:p2', geoLat: 34.8963, geoLng: 135.8123 },
  '42:q1': { id: '42:q1', geoLat: 35.0, geoLng: 136.0 },
}

beforeEach(() => {
  findMany.mockReset()
  findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => {
    return where.id.in.map((id) => DB_ROWS[id]).filter(Boolean)
  })
})

describe('PrismaPointFinder.getPointsByIds 裸 id 容错', () => {
  it('全部精确命中时只查一次，按原样 id 返回', async () => {
    const finder = new PrismaPointFinder()
    const out = await finder.getPointsByIds(['115908:p1', '42:q1'])

    expect(out.map((p) => p.id)).toEqual(['115908:p1', '42:q1'])
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany.mock.calls[0][0].where.id.in).toEqual(['115908:p1', '42:q1'])
  })

  it('裸 id 未命中且给了候选 bangumiIds 时，用 scoped id 兜底重查并返回完整 id', async () => {
    const finder = new PrismaPointFinder()
    const out = await finder.getPointsByIds(['115908:p1', 'p2'], [115908])

    expect(findMany).toHaveBeenCalledTimes(2)
    // 第二轮查询的候选是拼出来的 scoped id
    expect(findMany.mock.calls[1][0].where.id.in).toEqual(['115908:p2'])
    // 返回的 id 是查询命中的完整形式，不是调用方传入的裸 id
    expect(out.map((p) => p.id)).toEqual(['115908:p1', '115908:p2'])
  })

  it('未命中的 id 本身含 ":" 时不再兜底（无法判断前缀）', async () => {
    const finder = new PrismaPointFinder()
    const out = await finder.getPointsByIds(['115908:p1', '999:nope'], [115908])

    expect(findMany).toHaveBeenCalledTimes(1)
    expect(out.map((p) => p.id)).toEqual(['115908:p1'])
  })

  it('候选 bangumiIds 为空时不做第二轮查询', async () => {
    const finder = new PrismaPointFinder()
    const out = await finder.getPointsByIds(['p2'])

    expect(findMany).toHaveBeenCalledTimes(1)
    expect(out).toEqual([])
  })

  it('多个 bangumiIds × 多个裸 id 生成全部组合候选并去重', async () => {
    const finder = new PrismaPointFinder()
    const out = await finder.getPointsByIds(['p2', 'q1'], [115908, 42])

    expect(findMany).toHaveBeenCalledTimes(2)
    expect([...findMany.mock.calls[1][0].where.id.in].sort()).toEqual(['115908:p2', '115908:q1', '42:p2', '42:q1'])
    expect(out.map((p) => p.id).sort()).toEqual(['115908:p2', '42:q1'])
  })
})
