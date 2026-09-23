import { describe, expect, it } from 'vitest'
import type { Session } from 'next-auth'
import { buildIcs } from '@/lib/routeBook/exportIcs'
import { createExportHandlers } from '@/lib/routeBook/handlers/export'
import { InMemoryRouteBookRepo } from '@/lib/routeBook/repoMemory'
import { InMemoryPointPoolRepo } from '@/lib/pointPool/repoMemory'
import type { RouteBookApiDeps } from '@/lib/routeBook/api'
import type { RouteBookDay, RouteBookItem, RouteBookPlace } from '@/lib/routeBook/repo'

const NOW = new Date('2026-09-23T00:00:00.000Z')

const days: RouteBookDay[] = [
  { id: 'day-1', routeBookId: 'bk', dayIndex: 1, date: new Date('2026-10-05T00:00:00.000Z'), title: '东山一日', defaultTravelMode: 'walking' },
  { id: 'day-2', routeBookId: 'bk', dayIndex: 2, date: new Date('2026-10-06T00:00:00.000Z'), title: null, defaultTravelMode: 'transit' },
  { id: 'day-3', routeBookId: 'bk', dayIndex: 3, date: null, title: '无日期天', defaultTravelMode: 'transit' },
]

function item(partial: Partial<RouteBookItem> & Pick<RouteBookItem, 'id' | 'dayId' | 'sortOrder' | 'kind'>): RouteBookItem {
  return {
    routeBookId: 'bk',
    pointId: null,
    placeId: null,
    title: null,
    note: null,
    timeStart: null,
    timeEnd: null,
    locked: false,
    icon: null,
    color: null,
    legMode: null,
    payload: null,
    createdAt: new Date('2026-09-23T00:00:00.000Z'),
    ...partial,
  }
}

const items: RouteBookItem[] = [
  item({ id: 'i1', dayId: 'day-1', sortOrder: 0, kind: 'point', pointId: 'p1', timeStart: '09:00' }),
  item({ id: 'i2', dayId: 'day-1', sortOrder: 1, kind: 'note', title: '买御朱印; 顺路, 喝茶', note: '第一条\n第二条', timeStart: '11:00' }),
  item({ id: 'i3', dayId: 'day-1', sortOrder: 2, kind: 'point', pointId: 'p1', timeStart: '23:30' }),
  item({ id: 'i4', dayId: 'day-2', sortOrder: 0, kind: 'point', pointId: 'p2', timeStart: '10:15', timeEnd: '11:45' }),
  item({ id: 'i5', dayId: 'day-3', sortOrder: 0, kind: 'point', pointId: 'p1', timeStart: '09:00' }),
]

const places: RouteBookPlace[] = [
  { id: 'place-hotel', routeBookId: 'bk', kind: 'lodging', title: '京都駅前酒店', address: null, lat: 34.9858, lng: 135.7588, note: null, createdAt: NOW },
]

const previews = new Map([
  ['p1', { title: '音羽&神社<参道>; 名所, 巡礼点——这是一个非常长的点位名称用来验证 ICS 七十五字节折叠规则是否正确实现' }],
  ['p2', { title: '宇治橋' }],
])

const baseInput = { title: '京都两日巡礼', days, items, places, previews, now: NOW }

describe('buildIcs', () => {
  it('全天事件 + 定时事件（timeEnd 缺省 +60 分钟、23:30 跨午夜）、转义与折叠', () => {
    const ics = buildIcs(baseInput)
    expect(ics).toMatchInlineSnapshot(`
      "BEGIN:VCALENDAR
      VERSION:2.0
      PRODID:-//SeichiGo//RouteBook//ZH
      CALSCALE:GREGORIAN
      X-WR-CALNAME:京都两日巡礼
      BEGIN:VTIMEZONE
      TZID:Asia/Tokyo
      BEGIN:STANDARD
      DTSTART:19700101T000000
      TZOFFSETFROM:+0900
      TZOFFSETTO:+0900
      TZNAME:JST
      END:STANDARD
      END:VTIMEZONE
      BEGIN:VEVENT
      UID:day-1@seichigo.com
      DTSTAMP:20260923T000000Z
      DTSTART;VALUE=DATE:20261005
      DTEND;VALUE=DATE:20261006
      SUMMARY:东山一日
      DESCRIPTION:09:00 音羽&神社<参道>\\; 名所\\, 巡礼点——这是一
       个非常长的点位名称用来验证 ICS 七十五字节折叠规则是
       否正确实现\\n11:00 买御朱印\\; 顺路\\, 喝茶\\n23:30 音羽&神社
       <参道>\\; 名所\\, 巡礼点——这是一个非常长的点位名称用
       来验证 ICS 七十五字节折叠规则是否正确实现
      END:VEVENT
      BEGIN:VEVENT
      UID:i1@seichigo.com
      DTSTAMP:20260923T000000Z
      DTSTART;TZID=Asia/Tokyo:20261005T090000
      DTEND;TZID=Asia/Tokyo:20261005T100000
      SUMMARY:音羽&神社<参道>\\; 名所\\, 巡礼点——这是一个非常
       长的点位名称用来验证 ICS 七十五字节折叠规则是否正确
       实现
      END:VEVENT
      BEGIN:VEVENT
      UID:i2@seichigo.com
      DTSTAMP:20260923T000000Z
      DTSTART;TZID=Asia/Tokyo:20261005T110000
      DTEND;TZID=Asia/Tokyo:20261005T120000
      SUMMARY:买御朱印\\; 顺路\\, 喝茶
      DESCRIPTION:第一条\\n第二条
      END:VEVENT
      BEGIN:VEVENT
      UID:i3@seichigo.com
      DTSTAMP:20260923T000000Z
      DTSTART;TZID=Asia/Tokyo:20261005T233000
      DTEND;TZID=Asia/Tokyo:20261006T003000
      SUMMARY:音羽&神社<参道>\\; 名所\\, 巡礼点——这是一个非常
       长的点位名称用来验证 ICS 七十五字节折叠规则是否正确
       实现
      END:VEVENT
      BEGIN:VEVENT
      UID:day-2@seichigo.com
      DTSTAMP:20260923T000000Z
      DTSTART;VALUE=DATE:20261006
      DTEND;VALUE=DATE:20261007
      SUMMARY:Day 2
      DESCRIPTION:10:15 宇治橋
      END:VEVENT
      BEGIN:VEVENT
      UID:i4@seichigo.com
      DTSTAMP:20260923T000000Z
      DTSTART;TZID=Asia/Tokyo:20261006T101500
      DTEND;TZID=Asia/Tokyo:20261006T114500
      SUMMARY:宇治橋
      END:VEVENT
      END:VCALENDAR
      "
    `)
  })

  it('TEXT 转义：分号/逗号/换行', () => {
    const ics = buildIcs(baseInput)
    expect(ics).toContain('买御朱印\\; 顺路\\, 喝茶')
    expect(ics).toContain('第一条\\n第二条')
  })

  it('timeEnd 不晚于 timeStart 时按 +60 分钟导出（缺省/早于/等于）', () => {
    const wrap = (timeEnd: string | null) =>
      buildIcs({
        ...baseInput,
        items: [item({ id: 'i9', dayId: 'day-2', sortOrder: 0, kind: 'point', pointId: 'p2', timeStart: '10:00', timeEnd })],
      })
    for (const ics of [wrap(null), wrap('09:30'), wrap('10:00')]) {
      expect(ics).toContain('DTSTART;TZID=Asia/Tokyo:20261006T100000')
      expect(ics).toContain('DTEND;TZID=Asia/Tokyo:20261006T110000')
    }
    // 晚于 timeStart 的 timeEnd 仍按原值
    expect(wrap('11:45')).toContain('DTEND;TZID=Asia/Tokyo:20261006T114500')
  })

  it('日历头：PRODID 为 SeichiGo、X-WR-CALNAME 为标题、CALSCALE 后跟 Asia/Tokyo VTIMEZONE', () => {
    const ics = buildIcs(baseInput)
    expect(ics).toContain('PRODID:-//SeichiGo//RouteBook//ZH')
    expect(ics).toContain('X-WR-CALNAME:京都两日巡礼')
    const calscaleIdx = ics.indexOf('CALSCALE:GREGORIAN')
    const vtimezoneIdx = ics.indexOf('BEGIN:VTIMEZONE')
    expect(vtimezoneIdx).toBeGreaterThan(calscaleIdx)
    expect(ics).toContain('TZID:Asia/Tokyo')
    expect(ics).toContain('TZOFFSETFROM:+0900')
    expect(ics).toContain('TZOFFSETTO:+0900')
    expect(ics).toContain('TZNAME:JST')
  })

  it('每行 ≤75 字节（折叠不拆多字节字符）', () => {
    const ics = buildIcs(baseInput)
    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    }
    // 长 SUMMARY 确实被折叠成多行
    expect(ics.split('\r\n').some((line) => line.startsWith(' '))).toBe(true)
  })

  it('无日期的天不产生事件；全部无日期输出空日历骨架', () => {
    const ics = buildIcs({ ...baseInput, days: [days[2]!] })
    expect(ics).not.toContain('BEGIN:VEVENT')
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('PRODID:-//SeichiGo//RouteBook//ZH')
  })
})

describe('export handlers', () => {
  function makeDeps(userId = 'u1') {
    let seq = 0
    let tick = 0
    const repo = new InMemoryRouteBookRepo({
      pointBangumiMap: new Map([
        ['p1', 1],
        ['p2', 1],
      ]),
      idFactory: () => `id-${++seq}`,
      now: () => new Date(Date.parse('2026-09-23T00:00:00.000Z') + tick++ * 1000),
    })
    const deps: RouteBookApiDeps = {
      repo,
      pointPoolRepo: new InMemoryPointPoolRepo({ pointBangumiMap: new Map([['p1', 1], ['p2', 1]]) }),
      getSession: async () => ({ user: { id: userId } } as Session),
      now: () => NOW,
      pointCoords: async (pointIds) => {
        const map = new Map<string, { lat: number; lng: number }>()
        for (const id of pointIds) {
          if (id === 'p1') map.set(id, { lat: 34.994856, lng: 135.785231 })
          if (id === 'p2') map.set(id, { lat: 34.8898, lng: 135.8084 })
        }
        return map
      },
      pointNames: async (pointIds) => {
        const map = new Map<string, string>()
        for (const id of pointIds) {
          if (id === 'p1') map.set(id, '音羽神社')
          if (id === 'p2') map.set(id, '宇治橋')
        }
        return map
      },
    }
    return { repo, deps }
  }

  const req = (url: string) => new Request(`http://localhost${url}`)
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

  it('未登录 401', async () => {
    const { deps } = makeDeps()
    const anon = { ...deps, getSession: async () => null }
    const gpx = await createExportHandlers(anon).GET_gpx(req('/x'), ctx('bk'))
    expect(gpx.status).toBe(401)
    const ics = await createExportHandlers(anon).GET_ics(req('/x'), ctx('bk'))
    expect(ics.status).toBe(401)
  })

  it('行程不存在 404', async () => {
    const { deps } = makeDeps()
    const res = await createExportHandlers(deps).GET_gpx(req('/x'), ctx('missing'))
    expect(res.status).toBe(404)
  })

  it('GPX：scope 非法 400；scope=day 输出该天；scope=all 输出全部', async () => {
    const { repo, deps } = makeDeps()
    const book = await repo.create('u1', '京都两日巡礼', 'draft', { startDate: new Date('2026-10-05T00:00:00.000Z'), dayCount: 2 })
    const detail = (await repo.getById(book.id, 'u1'))!
    const day1 = detail.days[0]!
    const day2 = detail.days[1]!
    await repo.createItem(book.id, 'u1', { dayId: day1.id, kind: 'point', pointId: 'p1' })
    await repo.createItem(book.id, 'u1', { dayId: day2.id, kind: 'point', pointId: 'p2' })

    const handlers = createExportHandlers(deps)
    const bad = await handlers.GET_gpx(req(`/x?scope=week`), ctx(book.id))
    expect(bad.status).toBe(400)

    const badDay = await handlers.GET_gpx(req(`/x?scope=day&dayIndex=9`), ctx(book.id))
    expect(badDay.status).toBe(400)

    const day = await handlers.GET_gpx(req(`/x?scope=day&dayIndex=1`), ctx(book.id))
    expect(day.status).toBe(200)
    expect(day.headers.get('Content-Type')).toBe('application/gpx+xml; charset=utf-8')
    expect(day.headers.get('Content-Disposition')).toBe(
      `attachment; filename="routebook.gpx"; filename*=UTF-8''${encodeURIComponent('京都两日巡礼')}.gpx`,
    )
    const body = await day.text()
    expect(body).toContain('音羽神社')
    expect(body.match(/<rte>/g)?.length).toBe(1)

    const all = await handlers.GET_gpx(req(`/x?scope=all`), ctx(book.id))
    expect((await all.text()).match(/<rte>/g)?.length).toBe(2)
  })

  it('ICS：无日期行程 400；有日期返回 text/calendar 附件', async () => {
    const { repo, deps } = makeDeps()
    const handlers = createExportHandlers(deps)

    const noDate = await repo.create('u1', '无日期本', 'draft', { dayCount: 2 })
    const rejected = await handlers.GET_ics(req('/x'), ctx(noDate.id))
    expect(rejected.status).toBe(400)
    expect(await rejected.json()).toEqual({ error: '行程没有日期，无法导出日历' })

    const book = await repo.create('u1', '京都两日巡礼', 'draft', { startDate: new Date('2026-10-05T00:00:00.000Z'), dayCount: 2 })
    const day1 = (await repo.getById(book.id, 'u1'))!.days[0]!
    await repo.createItem(book.id, 'u1', { dayId: day1.id, kind: 'point', pointId: 'p1', timeStart: '09:30' })

    const res = await handlers.GET_ics(req('/x'), ctx(book.id))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8')
    expect(res.headers.get('Content-Disposition')).toBe(
      `attachment; filename="routebook.ics"; filename*=UTF-8''${encodeURIComponent('京都两日巡礼')}.ics`,
    )
    const body = await res.text()
    expect(body).toContain('BEGIN:VCALENDAR')
    expect(body).toContain('DTSTART;TZID=Asia/Tokyo:20261005T093000')
    expect(body).toContain('DTEND;TZID=Asia/Tokyo:20261005T103000')
    expect(body).toContain('DTSTART;VALUE=DATE:20261005')
  })

  it('X10：文件名 RFC 5987 额外编码 \'()*!；标题为空时用 routebook', async () => {
    const { repo, deps } = makeDeps()
    const handlers = createExportHandlers(deps)

    const special = await repo.create('u1', '京都(两日)!巡礼*', 'draft', { dayCount: 1 })
    const gpx = await handlers.GET_gpx(req(`/x?scope=all`), ctx(special.id))
    expect(gpx.status).toBe(200)
    const disposition = gpx.headers.get('Content-Disposition')!
    expect(disposition).toContain('filename="routebook.gpx"')
    expect(disposition).toContain('%28%E4%B8%A4%E6%97%A5%29') // (两日)
    expect(disposition).toContain('%21') // !
    expect(disposition).toContain('%2A') // *
    expect(disposition).not.toContain('京都')

    const empty = await repo.create('u1', '', 'draft', { dayCount: 1 })
    const ics = await handlers.GET_gpx(req(`/x?scope=all`), ctx(empty.id))
    expect(ics.headers.get('Content-Disposition')).toBe(`attachment; filename="routebook.gpx"; filename*=UTF-8''routebook.gpx`)
  })
})
