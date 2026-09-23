import { describe, expect, it } from 'vitest'
import { InMemoryRouteBookRepo } from '@/lib/routeBook/repoMemory'
import { RouteBookRuleError } from '@/lib/routeBook/rules'
import type { RouteBookDay, RouteBookDetail } from '@/lib/routeBook/repo'

function makeRepo(pointIds: string[] = []) {
  let seq = 0
  let tick = 0
  const pointBangumiMap = new Map(pointIds.map((id, index) => [id, index + 1] as const))
  const repo = new InMemoryRouteBookRepo({
    idFactory: () => `id-${++seq}`,
    now: () => new Date(Date.parse('2026-09-23T00:00:00.000Z') + tick++ * 1000),
    pointBangumiMap,
  })
  return { repo, pointBangumiMap }
}

async function expectRuleError(promise: Promise<unknown>, reason: string, messageContains?: string) {
  await expect(promise).rejects.toBeInstanceOf(RouteBookRuleError)
  await expect(promise).rejects.toMatchObject({ reason })
  if (messageContains) {
    await expect(promise).rejects.toHaveProperty('message', expect.stringContaining(messageContains))
  }
}

async function dayAt(detail: RouteBookDetail, dayIndex: number): Promise<RouteBookDay> {
  const day = detail.days.find((d) => d.dayIndex === dayIndex)
  if (!day) throw new Error(`day ${dayIndex} not found`)
  return day
}

describe('InMemoryRouteBookRepo', () => {
  it('create 自动建 Day 1..dayCount 并按 startDate 派生日期', async () => {
    const { repo } = makeRepo(['p1'])
    const book = await repo.create('u1', '京吹五日', 'draft', {
      dayCount: 3,
      startDate: new Date('2026-10-01T00:00:00.000Z'),
    })
    const detail = await repo.getById(book.id, 'u1')
    expect(detail?.days.map((d) => d.dayIndex)).toEqual([1, 2, 3])
    expect(detail?.days[0]?.date?.toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(detail?.days[2]?.date?.toISOString()).toBe('2026-10-03T00:00:00.000Z')
    expect(detail?.days[0]?.defaultTravelMode).toBe('transit')

    const single = await repo.create('u1', '单日本', 'draft')
    const singleDetail = await repo.getById(single.id, 'u1')
    expect(singleDetail?.days).toHaveLength(1)
    expect(singleDetail?.days[0]?.date).toBeNull()

    await expectRuleError(repo.create('u1', '超天本', 'draft', { dayCount: 31 }), 'invalid')
  })

  it('insertDay/deleteDay 平移 lodging 下标，to<from 的整条删除', async () => {
    const { repo } = makeRepo()
    const book = await repo.create('u1', '本', 'draft', { dayCount: 4 })
    const detail = await repo.getById(book.id, 'u1')
    const d1 = detail!.days[0]!
    const d2 = detail!.days[1]!
    const d3 = detail!.days[2]!

    const stay = await repo.createPlace(book.id, 'u1', { kind: 'lodging', title: '酒店A', lat: 35.0, lng: 135.0 })
    await repo.createLodging(book.id, 'u1', { placeId: stay.id, fromDayIndex: 2, toDayIndex: 4 })
    const dayAnchor = await repo.createPlace(book.id, 'u1', { kind: 'lodging', title: '锚点酒店', lat: 35.1, lng: 135.1 })
    await repo.createLodging(book.id, 'u1', { placeId: dayAnchor.id, fromDayIndex: 2, toDayIndex: 2 })

    const inserted = await repo.insertDay(book.id, 'u1', 2)
    expect(inserted.dayIndex).toBe(3)
    let after = await repo.getById(book.id, 'u1')
    expect(after!.days.map((d) => d.dayIndex)).toEqual([1, 2, 3, 4, 5])
    expect(after!.lodgings.find((l) => l.placeId === stay.id)).toMatchObject({ fromDayIndex: 2, toDayIndex: 5 })
    expect(after!.lodgings.find((l) => l.placeId === dayAnchor.id)).toMatchObject({ fromDayIndex: 2, toDayIndex: 2 })

    await repo.deleteDay(book.id, 'u1', inserted.id)
    after = await repo.getById(book.id, 'u1')
    expect(after!.days.map((d) => d.dayIndex)).toEqual([1, 2, 3, 4])
    expect(after!.lodgings.find((l) => l.placeId === stay.id)).toMatchObject({ fromDayIndex: 2, toDayIndex: 4 })

    // 非空天不可删
    await repo.createItem(book.id, 'u1', { dayId: d1.id, kind: 'note', title: '备注' })
    await expectRuleError(repo.deleteDay(book.id, 'u1', d1.id), 'day_not_empty')

    // 最后一天不可删
    const twoDayBook = await repo.create('u1', '两天本', 'draft', { dayCount: 2 })
    const twoDays = (await repo.getById(twoDayBook.id, 'u1'))!.days
    await repo.deleteDay(twoDayBook.id, 'u1', twoDays[1]!.id)
    await expectRuleError(repo.deleteDay(twoDayBook.id, 'u1', twoDays[0]!.id), 'invalid')

    // 删锚点天 d2：stay [2,4]→[2,3]；anchor [2,2]→ to(1)<from(2) 整条删除
    await repo.deleteDay(book.id, 'u1', d2.id)
    after = await repo.getById(book.id, 'u1')
    expect(after!.lodgings.find((l) => l.placeId === stay.id)).toMatchObject({ fromDayIndex: 2, toDayIndex: 3 })
    expect(after!.lodgings.find((l) => l.placeId === dayAnchor.id)).toBeUndefined()
    expect(after!.days.map((d) => d.id)).toEqual([d1.id, d3.id, detail!.days[3]!.id])
  })

  it('reorderDays 只重编 dayIndex 并重算 date，不动 lodging', async () => {
    const { repo } = makeRepo()
    const book = await repo.create('u1', '本', 'draft', {
      dayCount: 3,
      startDate: new Date('2026-10-01T00:00:00.000Z'),
    })
    const detail = (await repo.getById(book.id, 'u1'))!
    const [da, db, dc] = detail.days

    const stay = await repo.createPlace(book.id, 'u1', { kind: 'lodging', title: '酒店', lat: 35, lng: 135 })
    await repo.createLodging(book.id, 'u1', { placeId: stay.id, fromDayIndex: 2, toDayIndex: 3 })

    const reordered = await repo.reorderDays(book.id, 'u1', [dc!.id, da!.id, db!.id])
    expect(reordered.days.map((d) => d.id)).toEqual([dc!.id, da!.id, db!.id])
    expect(reordered.days.map((d) => d.date?.toISOString().slice(0, 10))).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    expect(reordered.bookUpdatedAt.getTime()).toBe((await repo.getById(book.id, 'u1'))!.updatedAt.getTime())

    const after = await repo.getById(book.id, 'u1')
    expect(after!.lodgings).toHaveLength(1)
    expect(after!.lodgings[0]).toMatchObject({ fromDayIndex: 2, toDayIndex: 3 })

    await expectRuleError(repo.reorderDays(book.id, 'u1', [da!.id, db!.id]), 'invalid')
    await expectRuleError(repo.reorderDays(book.id, 'u1', [da!.id, da!.id, db!.id]), 'invalid')
  })

  it('reorderItems 天内排序、跨天移动、未安排↔天', async () => {
    const { repo } = makeRepo(['p1', 'p2', 'p3'])
    const book = await repo.create('u1', '本', 'draft', { dayCount: 2 })
    const detail = (await repo.getById(book.id, 'u1'))!
    const day1 = detail.days[0]!
    const day2 = detail.days[1]!

    const a = (await repo.createItem(book.id, 'u1', { dayId: day1.id, kind: 'point', pointId: 'p1' })).item
    const b = (await repo.createItem(book.id, 'u1', { dayId: day1.id, kind: 'point', pointId: 'p2' })).item
    const c = (await repo.createItem(book.id, 'u1', { dayId: day1.id, kind: 'point', pointId: 'p3' })).item

    let res = await repo.reorderItems(book.id, 'u1', day1.id, [c.id, a.id, b.id])
    let items = res.items.filter((i) => i.dayId === day1.id)
    expect(items.map((i) => i.id)).toEqual([c.id, a.id, b.id])
    expect(items.map((i) => i.sortOrder)).toEqual([0, 1, 2])

    // 跨天：把 c 移到 day2
    res = await repo.reorderItems(book.id, 'u1', day2.id, [c.id])
    expect(res.items.find((i) => i.id === c.id)?.dayId).toBe(day2.id)
    expect(res.items.filter((i) => i.dayId === day1.id).map((i) => i.id)).toEqual([a.id, b.id])
    expect(res.items.filter((i) => i.dayId === day1.id).map((i) => i.sortOrder)).toEqual([0, 1])

    // 未安排 → 天
    const u = (await repo.createItem(book.id, 'u1', { dayId: null, kind: 'note', title: '未安排备注' })).item
    res = await repo.reorderItems(book.id, 'u1', day1.id, [a.id, u.id, b.id])
    expect(res.items.find((i) => i.id === u.id)?.dayId).toBe(day1.id)

    // 天 → 未安排
    res = await repo.reorderItems(book.id, 'u1', null, [u.id])
    expect(res.items.find((i) => i.id === u.id)?.dayId).toBeNull()
  })

  it('每天 25 条上限只统计 point/place，note 不占额', async () => {
    const { repo } = makeRepo(Array.from({ length: 30 }, (_, i) => `p${i + 1}`))
    const book = await repo.create('u1', '本', 'draft')
    const day = (await repo.getById(book.id, 'u1'))!.days[0]!

    for (let i = 0; i < 25; i++) {
      await repo.createItem(book.id, 'u1', { dayId: day.id, kind: 'point', pointId: `p${i + 1}` })
    }
    await repo.createItem(book.id, 'u1', { dayId: day.id, kind: 'note', title: '备注1' })
    const detail = await repo.getById(book.id, 'u1')
    expect(detail!.items.filter((i) => i.dayId === day.id)).toHaveLength(26)

    await expectRuleError(repo.createItem(book.id, 'u1', { dayId: day.id, kind: 'point', pointId: 'p26' }), 'day_limit')
    await repo.createItem(book.id, 'u1', { dayId: day.id, kind: 'note', title: '备注2' })

    // 未安排不限
    for (let i = 0; i < 26; i++) {
      await repo.createItem(book.id, 'u1', { dayId: null, kind: 'point', pointId: `p${(i % 26) + 1}` })
    }
  })

  it('锚顺序校验只看 locked && timeStart，且 reorder/updateItem 都会跑', async () => {
    const { repo } = makeRepo(['p1', 'p2'])
    const book = await repo.create('u1', '本', 'draft')
    const day = (await repo.getById(book.id, 'u1'))!.days[0]!

    const early = (await repo.createItem(book.id, 'u1', { dayId: day.id, kind: 'point', pointId: 'p1', title: '早' })).item
    const late = (await repo.createItem(book.id, 'u1', { dayId: day.id, kind: 'point', pointId: 'p2', title: '晚' })).item
    await repo.updateItem(book.id, 'u1', early.id, { timeStart: '09:00' })
    await repo.updateItem(book.id, 'u1', late.id, { timeStart: '10:00' })

    // 未锁定：乱序允许
    await repo.reorderItems(book.id, 'u1', day.id, [late.id, early.id])
    // 恢复合法顺序后再锁定
    await repo.reorderItems(book.id, 'u1', day.id, [early.id, late.id])
    await repo.updateItem(book.id, 'u1', late.id, { locked: true })
    await repo.updateItem(book.id, 'u1', early.id, { locked: true })

    await expectRuleError(
      repo.reorderItems(book.id, 'u1', day.id, [late.id, early.id]),
      'anchor_order',
      '「早」(09:00) 必须排在「晚」(10:00) 之后'
    )
    // 恢复合法顺序
    await repo.reorderItems(book.id, 'u1', day.id, [early.id, late.id])

    // updateItem 把早的条目改晚 → 违反锚顺序
    await expectRuleError(repo.updateItem(book.id, 'u1', early.id, { timeStart: '11:00' }), 'anchor_order')

    // 只有 timeStart 不锁定：乱序 OK（只显示不约束）
    await repo.updateItem(book.id, 'u1', early.id, { locked: false })
    await repo.reorderItems(book.id, 'u1', day.id, [late.id, early.id])
  })

  it('reorderItems 列表缺条目/跨本条目/未知条目都拒绝', async () => {
    const { repo } = makeRepo(['p1', 'p2'])
    const book = await repo.create('u1', '本', 'draft')
    const day = (await repo.getById(book.id, 'u1'))!.days[0]!
    const a = (await repo.createItem(book.id, 'u1', { dayId: day.id, kind: 'point', pointId: 'p1' })).item
    const b = (await repo.createItem(book.id, 'u1', { dayId: day.id, kind: 'point', pointId: 'p2' })).item

    await expectRuleError(repo.reorderItems(book.id, 'u1', day.id, [a.id]), 'invalid', '列表与当前条目不一致')
    await expectRuleError(repo.reorderItems(book.id, 'u1', day.id, [a.id, b.id, 'id-不存在']), 'invalid')
    await expectRuleError(repo.reorderItems(book.id, 'u1', day.id, [a.id, a.id, b.id]), 'invalid')

    const other = await repo.create('u1', '另一本', 'draft')
    const foreign = (await repo.createItem(other.id, 'u1', { dayId: null, kind: 'note', title: '别家的' })).item
    await expectRuleError(repo.reorderItems(book.id, 'u1', day.id, [a.id, b.id, foreign.id]), 'invalid')

    // 跨本 dayId / 不存在 dayId 的 createItem 也拒绝
    await expectRuleError(repo.createItem(book.id, 'u1', { dayId: 'id-别家天', kind: 'point', pointId: 'p1' }), 'invalid')
  })

  it('reorderItems 目标 dayId 必须归属本行程本：外本/不存在 → invalid', async () => {
    const { repo } = makeRepo(['p1'])
    const book = await repo.create('u1', '本', 'draft')
    const day = (await repo.getById(book.id, 'u1'))!.days[0]!
    const a = (await repo.createItem(book.id, 'u1', { dayId: null, kind: 'point', pointId: 'p1' })).item

    await expectRuleError(repo.reorderItems(book.id, 'u1', 'id-不存在', [a.id]), 'invalid', '目标天不存在')

    const other = await repo.create('u1', '另一本', 'draft')
    const otherDay = (await repo.getById(other.id, 'u1'))!.days[0]!
    await expectRuleError(repo.reorderItems(book.id, 'u1', otherDay.id, [a.id]), 'invalid', '目标天不存在')
    // 失败后条目未被动过
    expect(((await repo.getById(book.id, 'u1'))!.items.find((i) => i.id === a.id))?.dayId).toBeNull()
  })

  it('transit 条目附着 prevItemId，prev 离开当天则删除', async () => {
    const { repo } = makeRepo(['p1', 'p2'])
    const book = await repo.create('u1', '本', 'draft')
    const day1 = (await repo.getById(book.id, 'u1'))!.days[0]!
    await repo.insertDay(book.id, 'u1', 1)
    const day2 = ((await repo.getById(book.id, 'u1'))!.days.find((d) => d.dayIndex === 2))!

    const p1 = (await repo.createItem(book.id, 'u1', { dayId: day1.id, kind: 'point', pointId: 'p1', title: 'P1' })).item
    const p2 = (await repo.createItem(book.id, 'u1', { dayId: day1.id, kind: 'point', pointId: 'p2', title: 'P2' })).item
    const transit = (await repo.createItem(book.id, 'u1', {
      dayId: day1.id,
      kind: 'transit',
      title: 'P1→P2 步行',
      payload: { transitBetween: { prevItemId: p1.id, nextItemId: p2.id } },
    })).item

    // 用户把 transit 拖到队首，normalize 仍把它送回 p1 后面
    await repo.reorderItems(book.id, 'u1', day1.id, [transit.id, p2.id, p1.id])
    let detail = await repo.getById(book.id, 'u1')
    expect(detail!.items.filter((i) => i.dayId === day1.id).map((i) => i.id)).toEqual([p2.id, p1.id, transit.id])
    expect(detail!.items.filter((i) => i.dayId === day1.id).map((i) => i.sortOrder)).toEqual([0, 1, 2])

    // p1 移到 day2 → transit 失效删除
    await repo.reorderItems(book.id, 'u1', day2.id, [p1.id])
    detail = await repo.getById(book.id, 'u1')
    expect(detail!.items.find((i) => i.id === transit.id)).toBeUndefined()
    expect(detail!.items.filter((i) => i.dayId === day1.id).map((i) => i.id)).toEqual([p2.id])
  })

  it('createItem 同天幂等、跨天允许、index 插入', async () => {
    const { repo } = makeRepo(['p1', 'p2', 'p3'])
    const book = await repo.create('u1', '本', 'draft', { dayCount: 2 })
    const detail = (await repo.getById(book.id, 'u1'))!
    const day1 = detail.days[0]!
    const day2 = detail.days[1]!

    const first = (await repo.createItem(book.id, 'u1', { dayId: day1.id, kind: 'point', pointId: 'p1' })).item
    const again = await repo.createItem(book.id, 'u1', { dayId: day1.id, kind: 'point', pointId: 'p1' })
    expect(again.item.id).toBe(first.id)
    expect(again.items.filter((i) => i.dayId === day1.id).map((i) => i.id)).toContain(first.id)

    const second = (await repo.createItem(book.id, 'u1', { dayId: day2.id, kind: 'point', pointId: 'p1' })).item
    expect(second.id).not.toBe(first.id)

    // index 插入到 0
    const inserted = (await repo.createItem(book.id, 'u1', { dayId: day1.id, kind: 'note', title: '插队', index: 0 })).item
    const day1Items = (await repo.getById(book.id, 'u1'))!.items.filter((i) => i.dayId === day1.id)
    expect(day1Items.map((i) => i.id)).toEqual([inserted.id, first.id])
  })

  it('deletePlace 级联删除条目与住宿', async () => {
    const { repo } = makeRepo(['p1'])
    const book = await repo.create('u1', '本', 'draft', { dayCount: 2 })
    const day1 = (await repo.getById(book.id, 'u1'))!.days[0]!

    const place = await repo.createPlace(book.id, 'u1', { kind: 'lodging', title: '酒店', lat: 35, lng: 135 })
    await repo.createItem(book.id, 'u1', { dayId: day1.id, kind: 'place', placeId: place.id })
    await repo.createItem(book.id, 'u1', { dayId: day1.id, kind: 'point', pointId: 'p1' })
    await repo.createLodging(book.id, 'u1', { placeId: place.id, fromDayIndex: 1, toDayIndex: 2 })

    expect((await repo.deletePlace(book.id, 'u1', place.id))?.bookUpdatedAt).toBeInstanceOf(Date)
    const detail = await repo.getById(book.id, 'u1')
    expect(detail!.places).toHaveLength(0)
    expect(detail!.lodgings).toHaveLength(0)
    expect(detail!.items.map((i) => i.kind)).toEqual(['point'])
  })

  it('lodging 夜晚重叠拒绝、背靠背允许', async () => {
    const { repo } = makeRepo()
    const book = await repo.create('u1', '本', 'draft', { dayCount: 6 })
    const a = await repo.createPlace(book.id, 'u1', { kind: 'lodging', title: 'A', lat: 35, lng: 135 })
    const b = await repo.createPlace(book.id, 'u1', { kind: 'lodging', title: 'B', lat: 35, lng: 135 })
    const c = await repo.createPlace(book.id, 'u1', { kind: 'restaurant', title: '食堂', lat: 35, lng: 135 })

    await repo.createLodging(book.id, 'u1', { placeId: a.id, fromDayIndex: 1, toDayIndex: 3 })
    // [1,3] 与 [3,5]：3 号退房 3 号入住，允许
    await repo.createLodging(book.id, 'u1', { placeId: b.id, fromDayIndex: 3, toDayIndex: 5 })
    // 夜晚 2 与 [1,3] 重叠
    await expectRuleError(repo.createLodging(book.id, 'u1', { placeId: b.id, fromDayIndex: 2, toDayIndex: 4 }), 'lodging_overlap')
    // 同酒店夜晚重叠也拒绝（[1,2] 的夜晚 1 撞上 [1,3]）
    await expectRuleError(repo.createLodging(book.id, 'u1', { placeId: a.id, fromDayIndex: 1, toDayIndex: 2 }), 'lodging_overlap')
    // from == to 的锚点区间（无夜晚）与任何区间都不交
    await repo.createLodging(book.id, 'u1', { placeId: b.id, fromDayIndex: 5, toDayIndex: 5 })
    // from > to 拒绝
    await expectRuleError(repo.createLodging(book.id, 'u1', { placeId: b.id, fromDayIndex: 4, toDayIndex: 2 }), 'invalid')
    // 非酒店 place 拒绝
    await expectRuleError(repo.createLodging(book.id, 'u1', { placeId: c.id, fromDayIndex: 6, toDayIndex: 6 }), 'invalid')

    // updateLodging 撞上已有区间也拒绝
    const lodging = (await repo.getById(book.id, 'u1'))!.lodgings.find((l) => l.placeId === b.id && l.toDayIndex === 5)!
    await expectRuleError(repo.updateLodging(book.id, 'u1', lodging.id, { fromDayIndex: 1 }), 'lodging_overlap')
  })

  it('update：startDate 重算各天 date、dayCount 只增不减、乐观锁 stale', async () => {
    const { repo } = makeRepo()
    const book = await repo.create('u1', '本', 'draft', { dayCount: 2 })
    const day2Id = (await repo.getById(book.id, 'u1'))!.days[1]!.id

    const start = new Date('2026-11-01T00:00:00.000Z')
    await repo.update(book.id, 'u1', { startDate: start })
    let detail = await repo.getById(book.id, 'u1')
    expect(detail!.days[1]!.date?.toISOString()).toBe('2026-11-02T00:00:00.000Z')

    await repo.update(book.id, 'u1', { startDate: new Date('2026-12-10T00:00:00.000Z') })
    detail = await repo.getById(book.id, 'u1')
    expect(detail!.days[0]!.date?.toISOString()).toBe('2026-12-10T00:00:00.000Z')
    expect(detail!.days[1]!.date?.toISOString()).toBe('2026-12-11T00:00:00.000Z')

    await repo.update(book.id, 'u1', { dayCount: 4 })
    detail = await repo.getById(book.id, 'u1')
    expect(detail!.days.map((d) => d.dayIndex)).toEqual([1, 2, 3, 4])
    expect(detail!.days[3]!.date?.toISOString()).toBe('2026-12-13T00:00:00.000Z')

    await repo.update(book.id, 'u1', { startDate: null })
    detail = await repo.getById(book.id, 'u1')
    expect(detail!.days.every((d) => d.date === null)).toBe(true)

    await expectRuleError(repo.update(book.id, 'u1', { dayCount: 2 }), 'invalid')

    const current = await repo.getById(book.id, 'u1')
    await repo.update(book.id, 'u1', { title: '改名' }, current!.updatedAt)
    await expectRuleError(repo.update(book.id, 'u1', { title: '再改名' }, current!.updatedAt), 'stale')
    expect(day2Id).toBeTruthy()

    // 别人的本：null
    expect(await repo.update(book.id, 'u2', { title: '偷改' })).toBeNull()
  })

  it('每次写入都推进 updatedAt，写方法返回 bookUpdatedAt', async () => {
    const { repo } = makeRepo(['p1'])
    const book = await repo.create('u1', '本', 'draft')
    const before = (await repo.getById(book.id, 'u1'))!.updatedAt

    const created = await repo.createItem(book.id, 'u1', { dayId: null, kind: 'point', pointId: 'p1' })
    expect(created.bookUpdatedAt.getTime()).toBeGreaterThan(before.getTime())

    const day = await repo.insertDay(book.id, 'u1', 0)
    const afterInsert = (await repo.getById(book.id, 'u1'))!.updatedAt
    expect(day.bookUpdatedAt.getTime()).toBe(afterInsert.getTime())

    const res = await repo.reorderItems(book.id, 'u1', null, [created.item.id])
    expect(res.bookUpdatedAt.getTime()).toBe((await repo.getById(book.id, 'u1'))!.updatedAt.getTime())

    // 连续写不带乐观锁也不冲突（stale 只属于 PATCH /）
    const again = await repo.reorderItems(book.id, 'u1', null, [created.item.id])
    expect(again.bookUpdatedAt.getTime()).toBeGreaterThanOrEqual(res.bookUpdatedAt.getTime())
  })

  it('getDayContext：目标天条目 + 本级 places/lodgings + pointCoords；外本天/外人/不存在 → null', async () => {
    // A2：坐标并入天上下文；p2 故意不提供坐标（null 坐标不进 Map）
    const pointCoordsTable = new Map([['p1', { lat: 35.01, lng: 135.76 }]])
    let seq = 0
    let tick = 0
    const repo = new InMemoryRouteBookRepo({
      idFactory: () => `id-${++seq}`,
      now: () => new Date(Date.parse('2026-09-23T00:00:00.000Z') + tick++ * 1000),
      pointBangumiMap: new Map([['p1', 1], ['p2', 2]]),
      pointCoords: async (ids) => {
        const map = new Map<string, { lat: number; lng: number }>()
        for (const id of ids) {
          const coords = pointCoordsTable.get(id)
          if (coords) map.set(id, coords)
        }
        return map
      },
    })
    const book = await repo.create('u1', '本', 'draft', { dayCount: 2 })
    const detail = (await repo.getById(book.id, 'u1'))!
    const day1 = detail.days[0]!
    const day2 = detail.days[1]!

    const stay = await repo.createPlace(book.id, 'u1', { kind: 'lodging', title: '酒店', lat: 35, lng: 135 })
    await repo.createLodging(book.id, 'u1', { placeId: stay.id, fromDayIndex: 1, toDayIndex: 2 })
    await repo.createItem(book.id, 'u1', { dayId: day1.id, kind: 'point', pointId: 'p1' })
    await repo.createItem(book.id, 'u1', { dayId: day2.id, kind: 'point', pointId: 'p2' })
    await repo.createItem(book.id, 'u1', { dayId: null, kind: 'note', title: '未安排' })

    const ctx = await repo.getDayContext(book.id, 'u1', day1.id)
    expect(ctx?.day.id).toBe(day1.id)
    expect(ctx?.items.map((i) => i.pointId)).toEqual(['p1'])
    expect(ctx?.places.map((p) => p.id)).toEqual([stay.id])
    expect(ctx?.lodgings.map((l) => l.placeId)).toEqual([stay.id])
    expect(ctx?.pointCoords.get('p1')).toEqual({ lat: 35.01, lng: 135.76 })
    expect(ctx?.pointCoords.has('p2')).toBe(false)

    const other = await repo.create('u1', '另一本', 'draft')
    const otherDay = (await repo.getById(other.id, 'u1'))!.days[0]!
    expect(await repo.getDayContext(book.id, 'u1', otherDay.id)).toBeNull()
    expect(await repo.getDayContext(book.id, 'u2', day1.id)).toBeNull()
    expect(await repo.getDayContext(book.id, 'u1', 'day-不存在')).toBeNull()
    expect(await repo.getDayContext('rb-不存在', 'u1', day1.id)).toBeNull()
  })
})
