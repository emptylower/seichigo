import { describe, expect, it } from 'vitest'
import { buildGpx } from '@/lib/routeBook/exportGpx'
import type { RouteBookDay, RouteBookItem, RouteBookLodging, RouteBookPlace } from '@/lib/routeBook/repo'

const days: RouteBookDay[] = [
  { id: 'day-1', routeBookId: 'bk', dayIndex: 1, date: new Date('2026-10-05T00:00:00.000Z'), title: '东山一日', defaultTravelMode: 'walking' },
  { id: 'day-2', routeBookId: 'bk', dayIndex: 2, date: new Date('2026-10-06T00:00:00.000Z'), title: null, defaultTravelMode: 'transit' },
  { id: 'day-3', routeBookId: 'bk', dayIndex: 3, date: null, title: null, defaultTravelMode: 'transit' },
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
  item({ id: 'i1', dayId: 'day-1', sortOrder: 0, kind: 'point', pointId: 'p1', note: '开场', timeStart: '09:00' }),
  item({ id: 'i2', dayId: 'day-1', sortOrder: 1, kind: 'note', title: '买御朱印' }),
  item({ id: 'i3', dayId: 'day-2', sortOrder: 0, kind: 'point', pointId: 'p3', timeStart: '10:15', timeEnd: '11:45' }),
  item({ id: 'i4', dayId: null, sortOrder: 0, kind: 'point', pointId: 'p1' }),
  item({ id: 'i5', dayId: 'day-3', sortOrder: 0, kind: 'point', pointId: 'p3' }),
]

const places: RouteBookPlace[] = [
  { id: 'place-hotel', routeBookId: 'bk', kind: 'lodging', title: '京都駅前酒店', address: null, lat: 34.9858, lng: 135.7588, note: '含早餐', createdAt: new Date('2026-09-23T00:00:00.000Z') },
]

const lodgings: RouteBookLodging[] = [
  { id: 'lg1', routeBookId: 'bk', placeId: 'place-hotel', fromDayIndex: 1, toDayIndex: 2, checkIn: '15:00', checkOut: '10:00', note: null },
]

const previews = new Map([
  ['p1', { title: '音羽&神社<参道>', lat: 34.994856, lng: 135.785231 }],
  ['p3', { title: '宇治橋', lat: 34.8898, lng: 135.8084 }],
])

const baseInput = { title: '京都两日巡礼', days, items, places, lodgings, previews }

describe('buildGpx', () => {
  it('scope=all：wpt + 每天一条 rte（住宿首尾、note/无坐标点位跳过）', () => {
    const gpx = buildGpx({ ...baseInput, scope: { kind: 'all' } })
    expect(gpx).toMatchInlineSnapshot(`
      "<?xml version="1.0" encoding="UTF-8"?>
      <gpx version="1.1" creator="SeichiGo" xmlns="http://www.topografix.com/GPX/1/1">
        <metadata>
          <name>京都两日巡礼</name>
        </metadata>
        <wpt lat="34.994856" lon="135.785231">
          <name>音羽&amp;神社&lt;参道&gt;</name>
          <desc>开场</desc>
          <sym>point</sym>
        </wpt>
        <wpt lat="34.889800" lon="135.808400">
          <name>宇治橋</name>
          <sym>point</sym>
        </wpt>
        <wpt lat="34.985800" lon="135.758800">
          <name>京都駅前酒店</name>
          <desc>含早餐</desc>
          <sym>lodging</sym>
        </wpt>
        <rte>
          <name>Day 1</name>
          <rtept lat="34.994856" lon="135.785231">
            <name>音羽&amp;神社&lt;参道&gt;</name>
          </rtept>
          <rtept lat="34.985800" lon="135.758800">
            <name>京都駅前酒店</name>
          </rtept>
        </rte>
        <rte>
          <name>Day 2</name>
          <rtept lat="34.985800" lon="135.758800">
            <name>京都駅前酒店</name>
          </rtept>
          <rtept lat="34.889800" lon="135.808400">
            <name>宇治橋</name>
          </rtept>
        </rte>
        <rte>
          <name>Day 3</name>
          <rtept lat="34.889800" lon="135.808400">
            <name>宇治橋</name>
          </rtept>
        </rte>
      </gpx>

      "
    `)
  })

  it('名称含 & 与 < 正确转义', () => {
    const gpx = buildGpx({ ...baseInput, scope: { kind: 'all' } })
    expect(gpx).toContain('<name>音羽&amp;神社&lt;参道&gt;</name>')
    expect(gpx).not.toContain('音羽&神社')
  })

  it('scope=day 只输出该天（wpt 与 rte 均限定，未安排条目不计）', () => {
    const gpx = buildGpx({ ...baseInput, scope: { kind: 'day', dayIndex: 2 } })
    expect(gpx).toMatchInlineSnapshot(`
      "<?xml version="1.0" encoding="UTF-8"?>
      <gpx version="1.1" creator="SeichiGo" xmlns="http://www.topografix.com/GPX/1/1">
        <metadata>
          <name>京都两日巡礼</name>
        </metadata>
        <wpt lat="34.889800" lon="135.808400">
          <name>宇治橋</name>
          <sym>point</sym>
        </wpt>
        <wpt lat="34.985800" lon="135.758800">
          <name>京都駅前酒店</name>
          <desc>含早餐</desc>
          <sym>lodging</sym>
        </wpt>
        <rte>
          <name>Day 2</name>
          <rtept lat="34.985800" lon="135.758800">
            <name>京都駅前酒店</name>
          </rtept>
          <rtept lat="34.889800" lon="135.808400">
            <name>宇治橋</name>
          </rtept>
        </rte>
      </gpx>

      "
    `)
  })

  it('同 pointId 多天只导一个 wpt；无坐标点位不出现在 wpt/rte', () => {
    const gpx = buildGpx({ ...baseInput, scope: { kind: 'all' } })
    expect(gpx.match(/<wpt /g)?.length).toBe(3) // p1 + p3 + 住宿
    expect(gpx.match(/<rte>/g)?.length).toBe(3) // 三个天都有有坐标条目（GPX 与日期无关）
  })
})
