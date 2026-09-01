import { describe, it, expect } from 'vitest'
import type { TripPlanItemView } from '@/lib/tripPlan/view'
import {
  collectProviderGeometry,
  dayTravelMode,
  ensureDayScheduleForRender,
  formatLegsText,
  formatTransportText,
  getMedia,
  getPlace,
  getSchedule,
  getTransport,
  isRoutablePointItem,
  itemLatLng,
  scheduleStartMinutes,
  sortItemsBySchedule,
} from '@/app/(authed)/plan/[id]/components/itemPayload'

function item(overrides: Partial<TripPlanItemView>): TripPlanItemView {
  return {
    id: 'i1',
    sortOrder: 0,
    type: 'point',
    pointId: null,
    timeHint: null,
    title: '条目',
    note: null,
    reason: null,
    payload: null,
    point: null,
    ...overrides,
  }
}

const disneyPlace = { provider: 'google', placeId: 'ChIJ1', name: '東京ディズニーランド', lat: 35.6329, lng: 139.8804 }

describe('payload 读取（历史/新数据兼容）', () => {
  it('M3 schedule/place/transport/media 正确解析', () => {
    const view = item({
      payload: {
        schedule: { start: '13:00', end: '15:00', confidence: 'reference' },
        place: disneyPlace,
        transport: { mode: 'transit', durationMin: 45, distanceKm: 20, transfers: 1 },
        media: { source: 'google_places', displayUrl: '/api/google/place-photo?ref=Aref1234567890' },
      },
    })
    expect(getSchedule(view)).toEqual({ start: '13:00', end: '15:00', confidence: 'reference' })
    expect(scheduleStartMinutes(getSchedule(view)!)).toBe(780)
    expect(getPlace(view)).toMatchObject({ placeId: 'ChIJ1', lat: 35.6329, lng: 139.8804 })
    expect(getTransport(view)).toMatchObject({ mode: 'transit', durationMin: 45, transfers: 1 })
    expect(getMedia(view)).toMatchObject({ source: 'google_places' })
  })

  it('M1 扁平交通 payload（mode/durationMin/distanceKm 挂根字段）仍然解析', () => {
    const view = item({ type: 'transit', payload: { mode: 'walk', durationMin: 8, distanceKm: 0.65 } })
    expect(getTransport(view)).toMatchObject({ mode: 'walk', durationMin: 8, distanceKm: 0.65 })
  })

  it('历史数据（payload null）全部返回 null，不抛错', () => {
    const view = item({ payload: null })
    expect(getSchedule(view)).toBeNull()
    expect(getPlace(view)).toBeNull()
    expect(getTransport(view)).toBeNull()
    expect(getMedia(view)).toBeNull()
    expect(itemLatLng(view)).toBeNull()
  })
})

describe('路由点判定与坐标', () => {
  it('站内点位（pointId + point 关联坐标）参与路由', () => {
    const view = item({ pointId: '115908:uji', point: { id: '115908:uji', name: '宇治橋', nameZh: '宇治桥', lat: 34.88, lng: 135.8, image: null } })
    expect(isRoutablePointItem(view)).toBe(true)
    expect(itemLatLng(view)).toEqual({ lat: 34.88, lng: 135.8 })
  })

  it('外部地点（pointId=null + payload.place）同样参与路由', () => {
    const view = item({ pointId: null, payload: { place: disneyPlace } })
    expect(isRoutablePointItem(view)).toBe(true)
    expect(itemLatLng(view)).toEqual({ lat: 35.6329, lng: 139.8804 })
  })

  it('attraction 挂带坐标的 payload.place 也按路由点处理', () => {
    const view = item({ type: 'attraction', payload: { place: disneyPlace } })
    expect(isRoutablePointItem(view)).toBe(true)
  })

  it('无坐标的 point（历史脏数据）不是路由点', () => {
    expect(isRoutablePointItem(item({}))).toBe(false)
  })
})

describe('交通文案', () => {
  it('主文案："步行 8 分钟 · 650m" / "自驾 40 分钟 · 32.5km"', () => {
    expect(formatTransportText({ mode: 'walk', durationMin: 8, distanceKm: 0.65 })).toBe('步行 8 分钟 · 650m')
    expect(formatTransportText({ mode: 'driving', durationMin: 40, distanceKm: 32.5 })).toBe('自驾 40 分钟 · 32.5km')
  })

  it('分段摘要：步行 → 线路(站数/上下车站) → 步行', () => {
    const text = formatLegsText({
      legs: [
        { mode: 'walk', durationMin: 3, distanceKm: 0.2 },
        { mode: 'transit', line: 'JR奈良线', fromStop: '京都駅', toStop: '宇治駅', numStops: 4 },
        { mode: 'walk', durationMin: 4, distanceKm: 0.3 },
      ],
    })
    expect(text).toBe('步行 3 分钟 · 200m → JR奈良线 4 站（从京都駅到宇治駅） → 步行 4 分钟 · 300m')
  })

  it('无 legs 返回 null（回退主文案）', () => {
    expect(formatLegsText({ mode: 'transit', durationMin: 45 })).toBeNull()
  })
})

describe('地图模式与 provider 几何', () => {
  it('任一自驾段 → driving，否则 walking', () => {
    expect(dayTravelMode([item({ type: 'transit', payload: { transport: { mode: 'driving' } } })])).toBe('driving')
    expect(dayTravelMode([item({ type: 'transit', payload: { transport: { mode: 'walk' } } })])).toBe('walking')
    expect(dayTravelMode([item({})])).toBe('walking')
  })

  it('拼接各 transit 段折线（[lat,lng] → [lng,lat]，跨段去重衔接点）', () => {
    const geometry = collectProviderGeometry([
      item({ type: 'transit', payload: { transport: { polyline: [[35.0, 139.0], [35.1, 139.1]] } } }),
      item({ type: 'transit', payload: { transport: { polyline: [[35.1, 139.1], [35.2, 139.2]] } } }),
    ])
    expect(geometry).toEqual([
      [139.0, 35.0],
      [139.1, 35.1],
      [139.2, 35.2],
    ])
  })
})

describe('渲染期时间兜底（M3 修订：历史数据也必须显示具体时钟时间）', () => {
  it('完全无 payload 的历史条目：按 09:00 起点推导出具体区间，"午后"不再作为唯一时间', () => {
    const legacy = [
      item({ id: 'a', type: 'point', pointId: 'p1', timeHint: '上午', point: { id: 'p1', name: 'A', nameZh: null, lat: 1, lng: 1, image: null } }),
      item({ id: 't', type: 'transit', title: '步行', payload: { mode: 'walk', durationMin: 10, distanceKm: 0.5 } }),
      item({ id: 'b', type: 'point', pointId: 'p2', timeHint: '午后', point: { id: 'p2', name: 'B', nameZh: null, lat: 2, lng: 2, image: null } }),
    ]
    const ensured = ensureDayScheduleForRender(legacy)
    expect(ensured).toHaveLength(3)
    expect(getSchedule(ensured[0]!)).toMatchObject({ start: '09:00', end: '10:00', confidence: 'reference' })
    expect(getSchedule(ensured[1]!)).toMatchObject({ start: '10:00', end: '10:10', confidence: 'estimated' })
    expect(getSchedule(ensured[2]!)).toMatchObject({ start: '13:00', confidence: 'reference' })
    // 原始对象不被改动（渲染层无副作用）
    expect(getSchedule(legacy[0]!)).toBeNull()
    // 临时索引标记绝不泄漏进渲染载荷
    expect(JSON.stringify(ensured)).not.toContain('__renderIndex')
    // 其它 payload 字段（M1 扁平交通）保留
    expect(getTransport(ensured[1]!)).toMatchObject({ mode: 'walk', durationMin: 10 })
  })

  it('已有 schedule 的条目原样保留（含 confidence 标注），缺失条目以显式时间为锚推导', () => {
    const mixed = [
      item({ id: 'a', payload: { schedule: { start: '14:00', end: '15:00', confidence: 'reference' }, place: disneyPlace } }),
      item({ id: 'b', timeHint: '16:30' }),
      item({ id: 'c' }),
    ]
    const ensured = ensureDayScheduleForRender(mixed)
    // 已有 schedule 原样保留（不被改写成 explicit）
    expect(getSchedule(ensured.find((i) => i.id === 'a')!)).toEqual({ start: '14:00', end: '15:00', confidence: 'reference' })
    expect(getSchedule(ensured.find((i) => i.id === 'b')!)).toMatchObject({ start: '16:30', confidence: 'explicit' })
    // c 无时间：顺延到 b 结束后
    expect(getSchedule(ensured.find((i) => i.id === 'c')!)).toMatchObject({ start: '17:30', confidence: 'estimated' })
    // 已有条目的 place 原样保留
    expect(getPlace(ensured.find((i) => i.id === 'a')!)).toMatchObject({ placeId: 'ChIJ1' })
  })

  it('全部条目都有 schedule 时零改写直通；归一化冲突时原样返回不阻塞渲染', () => {
    const allScheduled = [item({ id: 'a', payload: { schedule: { start: '09:00', end: '10:00', confidence: 'explicit' } } })]
    expect(ensureDayScheduleForRender(allScheduled)).toBe(allScheduled)

    const conflictingLegacy = [
      item({ id: 'a', timeHint: '10:00-12:00' }),
      item({ id: 'b', timeHint: '11:00-12:00' }),
    ]
    expect(ensureDayScheduleForRender(conflictingLegacy)).toBe(conflictingLegacy)
  })
})

describe('防御性排序', () => {
  it('按 schedule.start 升序；无 schedule 的条目保持原相对顺序垫底', () => {
    const sorted = sortItemsBySchedule([
      item({ id: 'a', payload: { schedule: { start: '14:00', end: '15:00', confidence: 'explicit' } } }),
      item({ id: 'no-time' }),
      item({ id: 'b', payload: { schedule: { start: '09:30', end: '10:30', confidence: 'explicit' } } }),
      item({ id: 'no-time-2' }),
    ])
    expect(sorted.map((i) => i.id)).toEqual(['b', 'a', 'no-time', 'no-time-2'])
  })

  it('乱序保存的条目也会被时间轴纠正（不信任插入顺序）', () => {
    const sorted = sortItemsBySchedule([
      item({ id: 'evening', payload: { schedule: { start: '18:00', end: '19:00', confidence: 'explicit' } } }),
      item({ id: 'morning', payload: { schedule: { start: '09:00', end: '10:00', confidence: 'explicit' } } }),
    ])
    expect(sorted.map((i) => i.id)).toEqual(['morning', 'evening'])
  })
})
