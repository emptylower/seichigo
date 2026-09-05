import { describe, it, expect } from 'vitest'
import {
  computeDepartureEpochSec,
  normalizeDaySchedule,
  DAY_START_MIN,
} from '@/lib/planAgent/schedule'

describe('normalizeDaySchedule', () => {
  it('显式 HH:mm / HH:mm-HH:mm 优先，并原样保留', () => {
    const result = normalizeDaySchedule([
      { type: 'point', title: '京都站', timeHint: '14:00-15:30' },
      { type: 'point', title: '宇治桥' },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items[0].payload.schedule).toMatchObject({ start: '14:00', end: '15:30', confidence: 'explicit' })
    // 缺失时间从上一条结束时刻顺延（默认 60 分钟游览）
    expect(result.items[1].payload.schedule).toMatchObject({ start: '15:30', end: '16:30', confidence: 'estimated' })
  })

  it('宽泛标签（午后/傍晚）换算参考时刻，被顶后降级 estimated 且时间只前进', () => {
    const result = normalizeDaySchedule([
      { type: 'point', title: '上午集合', timeHint: '上午' },
      { type: 'point', title: '午后巡礼', timeHint: '午后' },
      { type: 'point', title: '傍晚合影', timeHint: '傍晚' },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [morning, afternoon, dusk] = result.items
    expect(morning.payload.schedule).toMatchObject({ start: '09:00', confidence: 'reference' })
    // 上午 09:00-10:00 → 午后参考 13:00 未被顶，仍是 reference
    expect(afternoon.payload.schedule).toMatchObject({ start: '13:00', confidence: 'reference' })
    // 午后结束 14:00 < 傍晚参考 17:00 → reference 保持
    expect(dusk.payload.schedule).toMatchObject({ start: '17:00', confidence: 'reference' })
  })

  it('参考时刻早于游标时取游标（时间不倒流），confidence 降级 estimated', () => {
    const result = normalizeDaySchedule([
      { type: 'point', title: '长停留', timeHint: '13:00', payload: { schedule: { durationMin: 300 } } },
      { type: 'point', title: '之后又要午后', timeHint: '午后' },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 13:00 + 300min = 18:00 结束；午后参考 13:00 < 18:00 → 顶到 18:00
    expect(result.items[1].payload.schedule).toMatchObject({ start: '18:00', confidence: 'estimated' })
  })

  it('transit 行进入同一时间序列：出发 = 上一条目结束，时长来自 payload.transport', () => {
    const result = normalizeDaySchedule([
      { type: 'point', title: 'A' },
      { type: 'transit', title: '公交去 B', payload: { transport: { mode: 'transit', durationMin: 25, distanceKm: 8 } } },
      { type: 'point', title: 'B' },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [a, transit, b] = result.items
    expect(a.payload.schedule).toMatchObject({ start: '09:00', end: '10:00' })
    expect(transit.payload.schedule).toMatchObject({ start: '10:00', end: '10:25', confidence: 'estimated' })
    expect(b.payload.schedule).toMatchObject({ start: '10:25' })
    // sortOrder 按时间重建且连续
    expect(result.items.map((i) => i.sortOrder)).toEqual([0, 1, 2])
  })

  it('乱序输入按解析后的本地开始时间排序（时间轴早 → 晚）', () => {
    const result = normalizeDaySchedule([
      { type: 'point', title: '下午点', timeHint: '14:00' },
      { type: 'point', title: '早上点', timeHint: '09:30' },
      { type: 'point', title: '中午点', timeHint: '11:00' },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items.map((i) => i.title)).toEqual(['早上点', '中午点', '下午点'])
    expect(
      result.items.map((i) => (i.payload.schedule as { start?: string } | undefined)?.start),
    ).toEqual(['09:30', '11:00', '14:00'])
  })

  it('显式时间区间重叠 → 显式错误（并列全部冲突，绝不静默丢点）', () => {
    const result = normalizeDaySchedule([
      { type: 'point', title: 'A', timeHint: '10:00-12:00' },
      { type: 'point', title: 'B', timeHint: '11:00-12:30' },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join('')).toContain('重叠')
    expect(result.errors.join('')).toContain('A')
    expect(result.errors.join('')).toContain('B')
  })

  it('M3 修订：推导区间与显式区间重叠 → 自愈顺延（A2：仅双显式非 transit 才报错）', () => {
    const result = normalizeDaySchedule([
      { type: 'point', title: '无时间条目' },
      { type: 'point', title: '显式条目', timeHint: '09:30-12:00' },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 推导 09:00–10:00 在前；显式 09:30–12:00 与之重叠 → 顺延到 10:00–12:30，降级 estimated
    expect(result.items.map((i) => i.title)).toEqual(['无时间条目', '显式条目'])
    expect(result.items[1].payload.schedule).toMatchObject({ start: '10:00', end: '12:30', confidence: 'estimated' })
  })

  it('M3 修订：宽泛换算区间被显式区间回跳覆盖 → 自愈顺延（A2）', () => {
    const result = normalizeDaySchedule([
      { type: 'point', title: '午后条目', timeHint: '午后' },
      { type: 'point', title: '显式条目', timeHint: '13:30-15:00' },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 午后参考 13:00–14:00 在前；显式 13:30–15:00 重叠 → 顺延到 14:00–15:30
    expect(result.items[1].payload.schedule).toMatchObject({ start: '14:00', end: '15:30', confidence: 'estimated' })
  })

  it('A2 回归（真实用例）：点位 09:30–10:30 显式 + 步行 transit 显式 09:40（11min）→ transit 顺延 10:30–10:41 estimated，不报错', () => {
    const result = normalizeDaySchedule([
      { type: 'point', title: '河口湖站', timeHint: '09:30-10:30' },
      { type: 'transit', title: '步行去下一站', timeHint: '09:40', payload: { transport: { mode: 'walk', durationMin: 11, distanceKm: 0.8 } } },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [point, transit] = result.items
    expect(point.payload.schedule).toMatchObject({ start: '09:30', end: '10:30', confidence: 'explicit' })
    expect(transit.payload.schedule).toMatchObject({ start: '10:30', end: '10:41', confidence: 'estimated' })
  })

  it('A2：transit 显式时间早于游标时忽略显式值（顺序颠倒输入同样自愈）', () => {
    const result = normalizeDaySchedule([
      { type: 'transit', title: '步行段', timeHint: '09:40', payload: { transport: { mode: 'walk', durationMin: 11 } } },
      { type: 'point', title: '河口湖站', timeHint: '09:30-10:30' },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 排序后点位（09:30–10:30）在前，transit（09:40）重叠 → 顺延到 10:30–10:41
    const [point, transit] = result.items
    expect(point.title).toBe('河口湖站')
    expect(transit.payload.schedule).toMatchObject({ start: '10:30', end: '10:41', confidence: 'estimated' })
  })

  it('A2：重叠顺延级联传导给后续条目（transit → 显式点位 → 推导点位）', () => {
    const result = normalizeDaySchedule([
      { type: 'transit', title: '长交通', payload: { transport: { mode: 'transit', durationMin: 90 } } },
      { type: 'point', title: '显式点', timeHint: '09:40-10:11' },
      { type: 'point', title: '推导点' },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 长交通 09:00–10:30；显式点 09:40–10:11 重叠 transit（非 transit+transit）→ 顺延 10:30–11:01；
    // 推导点原本从游标 11:01 起（第一遍按输入序游标已推进），实际落在 11:01–12:01
    const [transit, explicit, derived] = result.items
    expect(transit.payload.schedule).toMatchObject({ start: '09:00', end: '10:30' })
    expect(explicit.payload.schedule).toMatchObject({ start: '10:30', end: '11:01', confidence: 'estimated' })
    expect(derived.payload.schedule).toMatchObject({ start: '11:01', end: '12:01', confidence: 'estimated' })
  })

  it('A2：两个显式 transit/点位对（非双显式非 transit）在扫描线里只顺延不报错', () => {
    const result = normalizeDaySchedule([
      { type: 'transit', title: 'T', timeHint: '09:40', payload: { transport: { mode: 'walk', durationMin: 11 } } },
      { type: 'point', title: 'A', timeHint: '09:30-10:30' },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 与上一条「顺序颠倒」同场景：扫描线遇到 transit 与显式点位重叠 → 顺延
    const [a, t] = result.items
    expect(a.title).toBe('A')
    expect(t.payload.schedule).toMatchObject({ start: '10:30', end: '10:41', confidence: 'estimated' })
  })

  it('边界回归：恰好重叠 1 分钟的区间也必须拒绝（A 10:00-11:00、B 10:59-12:00）', () => {
    const result = normalizeDaySchedule([
      { type: 'point', title: 'A', timeHint: '10:00-11:00' },
      { type: 'point', title: 'B', timeHint: '10:59-12:00' },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    const message = result.errors.join('')
    expect(message).toContain('重叠')
    expect(message).toContain('A')
    expect(message).toContain('10:00–11:00')
    expect(message).toContain('B')
    expect(message).toContain('10:59–12:00')
  })

  it('M3 修订：合法相邻区间通过（推导 09:00–10:00 + 显式 10:00–11:00 + transit 精确衔接）', () => {
    const result = normalizeDaySchedule([
      { type: 'point', title: 'A' },
      { type: 'point', title: 'B', timeHint: '10:00-11:00' },
      { type: 'transit', title: '去下一站', payload: { transport: { mode: 'transit', durationMin: 20 } } },
      { type: 'point', title: 'C', timeHint: '11:20-12:00' },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items.map((i) => i.title)).toEqual(['A', 'B', '去下一站', 'C'])
    expect(
      result.items.map((i) => (i.payload.schedule as { start?: string } | undefined)?.start),
    ).toEqual(['09:00', '10:00', '11:00', '11:20'])
  })

  it('非法显式区间（结束早于开始）→ 显式错误', () => {
    const result = normalizeDaySchedule([{ type: 'point', title: 'A', timeHint: '15:00-13:00' }])
    expect(result.ok).toBe(false)
    expect(!result.ok && result.errors[0]).toContain('不合法')
  })

  it('不合法的时刻（25:00）不被当作显式时间，按缺失时间推导', () => {
    const result = normalizeDaySchedule([{ type: 'point', title: 'A', timeHint: '25:00' }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items[0].payload.schedule).toMatchObject({ start: '09:00', confidence: 'estimated' })
  })

  it('保留原有 payload 字段（place/transport/media 原样穿透，schedule 追加）', () => {
    const result = normalizeDaySchedule([
      {
        type: 'point',
        title: '迪士尼',
        payload: { place: { placeId: 'ChIJ1', name: '迪士尼', lat: 35.6, lng: 139.8 }, media: { source: 'google_places' } },
      },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const payload = result.items[0].payload
    expect(payload.place).toMatchObject({ placeId: 'ChIJ1' })
    expect(payload.media).toMatchObject({ source: 'google_places' })
    expect(payload.schedule).toMatchObject({ start: `${String(DAY_START_MIN / 60).padStart(2, '0')}:00` })
  })
})

describe('computeDepartureEpochSec（精确日期 → Google departure_time）', () => {
  it('按目的地时区（默认 +540）把当地时钟换算成 UTC epoch 秒', () => {
    // 2026-09-15 当地 09:00（Asia/Tokyo）= 2026-09-15T00:00:00Z
    const epoch = computeDepartureEpochSec(new Date('2026-09-15T00:00:00Z'), 1, 9 * 60)
    expect(epoch).toBe(Date.UTC(2026, 8, 15, 0, 0, 0) / 1000)

    // 第 2 天 14:30 当地 = 2026-09-16T05:30:00Z
    const day2 = computeDepartureEpochSec(new Date('2026-09-15T00:00:00Z'), 2, 14 * 60 + 30)
    expect(day2).toBe(Date.UTC(2026, 8, 16, 5, 30, 0) / 1000)
  })

  it('模糊日期（startDate=null）返回 null——Google 按当前典型班次查询', () => {
    expect(computeDepartureEpochSec(null, 1, 540)).toBeNull()
    expect(computeDepartureEpochSec(new Date('invalid'), 1, 540)).toBeNull()
  })
})
