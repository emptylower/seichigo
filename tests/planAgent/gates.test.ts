import { describe, it, expect } from 'vitest'
import { evaluatePlanGates, type GateDayInput, type GatePointCoord } from '@/lib/planAgent/gates'

/**
 * 门控判定（M4 §5）：每个门一条正例（通过）+ 一条反例（失败），外加 stats 计数。
 * 所有用例共用同一张点位坐标表（p1/p2 带 image，p3 无 image）。
 */
const coords = new Map<string, GatePointCoord>([
  ['p1', { lat: 34.8892, lng: 135.8075, image: '/img/p1.jpg' }],
  ['p2', { lat: 34.8963, lng: 135.8123, image: '/img/p2.jpg' }],
  ['p3', { lat: 34.9858, lng: 135.7585, image: null }],
])

const place = (over: Record<string, unknown> = {}) => ({
  provider: 'google',
  placeId: 'ChIJ_x',
  name: '某地点',
  lat: 35.01,
  lng: 135.76,
  ...over,
})

const transit = (over: Record<string, unknown> = {}) => ({
  type: 'transit',
  title: 'A → B',
  payload: { transport: { mode: 'transit', durationMin: 20, distanceKm: 5, provider: 'google', ...over } },
})

const schedule = (start: string, end: string) => ({ schedule: { start, end } })

/** 标准合格的一天：两个带坐标/图片的点位 + 一条真实交通 + 合法时间跨度 */
function healthyDay(): GateDayInput {
  return {
    dayIndex: 1,
    items: [
      { type: 'point', pointId: 'p1', title: '宇治桥', payload: schedule('09:00', '10:00') },
      transit(),
      { type: 'point', pointId: 'p2', title: '大吉山', payload: schedule('10:20', '11:20') },
    ],
  }
}

describe('evaluatePlanGates 坐标门', () => {
  it('正例：pointId 命中坐标表 / payload.place 提供坐标 → 通过', () => {
    const days: GateDayInput[] = [
      {
        dayIndex: 1,
        items: [
          { type: 'attraction', title: '外部景点', payload: { ...schedule('09:00', '10:00'), place: place() } },
          transit(),
          { type: 'point', pointId: 'p1', title: '宇治桥', payload: schedule('10:20', '11:20') },
        ],
      },
    ]
    const report = evaluatePlanGates(days, coords, true)
    expect(report.hard.filter((f) => f.gate === 'coords')).toHaveLength(0)
  })

  it('N2：lodging/meal 无 pointId 也无 place → soft（外部服务故障不拦保存），fix 指明下一回合补齐', () => {
    const days: GateDayInput[] = [
      {
        dayIndex: 2,
        items: [
          { type: 'lodging', title: '神秘酒店', payload: schedule('19:00', '20:00') },
          { type: 'meal', title: '未解析餐厅', payload: schedule('12:00', '13:00') },
        ],
      },
    ]
    const report = evaluatePlanGates(days, coords, true)
    const failures = report.soft.filter((f) => f.gate === 'coords')
    expect(failures.map((f) => f.itemTitle)).toEqual(['神秘酒店', '未解析餐厅'])
    for (const failure of failures) {
      expect(failure.severity).toBe('soft')
      expect(failure.fix).toContain('地点未能解析')
      expect(failure.fix).toContain('下一回合继续补齐')
    }
    expect(report.hard.filter((f) => f.gate === 'coords')).toHaveLength(0)
    expect(report.passed).toBe(true)
  })

  it('N2：point（含 pointId 或 place）与 attraction 无坐标 → 仍 hard', () => {
    const days: GateDayInput[] = [
      {
        dayIndex: 1,
        items: [
          { type: 'point', pointId: 'p_missing', title: '失联点位', payload: schedule('09:00', '10:00') },
          { type: 'attraction', title: '无坐标景点', payload: schedule('10:00', '11:00') },
        ],
      },
    ]
    const report = evaluatePlanGates(days, coords, true)
    const failures = report.hard.filter((f) => f.gate === 'coords')
    expect(failures.map((f) => f.itemTitle)).toEqual(['失联点位', '无坐标景点'])
    for (const failure of failures) expect(failure.severity).toBe('hard')
    expect(report.passed).toBe(false)
  })
})

describe('evaluatePlanGates 交通门（soft）', () => {
  it('相邻有坐标条目之间无 transit（或 provider 为空）→ soft（不拒绝落库），fix 指明两端', () => {
    const days: GateDayInput[] = [
      {
        dayIndex: 1,
        items: [
          { type: 'point', pointId: 'p1', title: '宇治桥', payload: schedule('09:00', '10:00') },
          { type: 'transit', title: '无 provider 交通', payload: { transport: { mode: 'walk', durationMin: 8 } } },
          { type: 'point', pointId: 'p2', title: '大吉山', payload: schedule('10:20', '11:20') },
        ],
      },
    ]
    const report = evaluatePlanGates(days, coords, true)
    expect(report.soft).toContainEqual(
      expect.objectContaining({
        gate: 'transport',
        severity: 'soft',
        itemTitle: '宇治桥 → 大吉山',
      }),
    )
    expect(report.stats.missingTransit).toBe(1)
    // 交通缺口是外部服务问题，不再硬拒绝
    expect(report.passed).toBe(true)
  })

  it('正例：相邻条目之间有 provider 非空的 transit → 通过（healthyDay 无 hard）', () => {
    const report = evaluatePlanGates([healthyDay()], coords, true)
    expect(report.hard).toHaveLength(0)
    expect(report.passed).toBe(true)
  })

  it('N6：payload.transport 存在但 provider 为空 → 不计入 transitLegs（估算占比分母不失真），只计入 missingTransit', () => {
    const days: GateDayInput[] = [
      {
        dayIndex: 1,
        items: [
          { type: 'point', pointId: 'p1', title: 'A', payload: schedule('09:00', '09:30') },
          { type: 'transit', title: 'A → B', payload: { transport: { mode: 'walk', durationMin: 8, provider: '' } } },
          { type: 'point', pointId: 'p2', title: 'B', payload: schedule('10:00', '10:30') },
          transit(),
          { type: 'point', pointId: 'p1', title: 'C', payload: schedule('11:00', '11:30') },
          transit({ estimated: true, provider: 'estimate' }),
          { type: 'point', pointId: 'p2', title: 'D', payload: schedule('12:00', '12:30') },
          transit({ estimated: true, provider: 'estimate' }),
          { type: 'point', pointId: 'p1', title: 'E', payload: schedule('13:00', '13:30') },
        ],
      },
    ]
    const report = evaluatePlanGates(days, coords, true)
    // 分母只含合格段（1 真实 + 2 估算）：2/3 > 0.6 触发估算门——若 provider
    // 空行也计入 transitLegs 会变成 2/4=0.5 漏报（正是 N6 要修的失真）
    expect(report.stats).toMatchObject({ transitLegs: 3, transitReal: 1, transitEstimated: 2, missingTransit: 1 })
    expect(report.soft).toContainEqual(expect.objectContaining({ gate: 'estimate_ratio' }))
    expect(report.soft).toContainEqual(expect.objectContaining({ gate: 'transport', itemTitle: 'A → B' }))
    expect(report.hard).toHaveLength(0)
  })

  it('M1 扁平载荷（mode/durationMin 在 payload 根上）→ 视为已有交通（provider legacy），不计缺口、不插第二行', () => {
    const days: GateDayInput[] = [
      {
        dayIndex: 1,
        items: [
          { type: 'point', pointId: 'p1', title: '宇治桥', payload: schedule('09:00', '10:00') },
          { type: 'transit', title: '步行前往大吉山', payload: { mode: 'walk', durationMin: 8, distanceKm: 0.65 } },
          { type: 'point', pointId: 'p2', title: '大吉山', payload: schedule('10:20', '11:20') },
        ],
      },
    ]
    const report = evaluatePlanGates(days, coords, true)
    expect(report.stats).toMatchObject({ transitLegs: 1, transitReal: 1, missingTransit: 0 })
    expect(report.soft.filter((f) => f.gate === 'transport')).toHaveLength(0)
    expect(report.hard).toHaveLength(0)
  })
})

describe('evaluatePlanGates 时间门', () => {
  it('反例：scheduleOk=false → hard（dayIndex 0 的全局失败）', () => {
    const report = evaluatePlanGates([healthyDay()], coords, false)
    expect(report.hard).toContainEqual(expect.objectContaining({ gate: 'schedule', severity: 'hard', dayIndex: 0 }))
    expect(report.passed).toBe(false)
  })

  it('首末 schedule 跨度 > 13h → soft（不拒绝）；lodging 不计入跨度', () => {
    const longDay: GateDayInput = {
      dayIndex: 1,
      items: [
        { type: 'point', pointId: 'p1', title: '早场', payload: schedule('07:00', '08:00') },
        transit(),
        { type: 'point', pointId: 'p2', title: '晚场', payload: schedule('21:00', '22:00') },
      ],
    }
    const report = evaluatePlanGates([longDay], coords, true)
    expect(report.soft).toContainEqual(expect.objectContaining({ gate: 'schedule', severity: 'soft', dayIndex: 1 }))
    expect(report.hard.filter((f) => f.gate === 'schedule')).toHaveLength(0)
    expect(report.passed).toBe(true)
    expect(report.stats.daySpanMaxMin).toBe(15 * 60)

    // 尾部的 lodging（酒店入住）不计入跨度：08:00–19:30 的行程 + 21:00 入住
    // 不再被误判为超 13 小时（含 lodging 会算出 14 小时）
    const lodgingTailDay: GateDayInput = {
      dayIndex: 2,
      items: [
        { type: 'point', pointId: 'p1', title: '早场', payload: schedule('08:00', '09:00') },
        { type: 'point', pointId: 'p2', title: '晚场', payload: schedule('19:00', '19:30') },
        { type: 'lodging', title: '酒店', payload: schedule('21:00', '22:00') },
      ],
    }
    const lodgingReport = evaluatePlanGates([lodgingTailDay], coords, true)
    expect(lodgingReport.soft.filter((f) => f.gate === 'schedule')).toHaveLength(0)
    expect(lodgingReport.stats.daySpanMaxMin).toBe(11 * 60 + 30)

    const okReport = evaluatePlanGates([healthyDay()], coords, true)
    expect(okReport.soft.filter((f) => f.gate === 'schedule')).toHaveLength(0)
  })
})

describe('evaluatePlanGates 出处门', () => {
  it('反例：payload.place 缺 provider/placeId → hard', () => {
    const days: GateDayInput[] = [
      {
        dayIndex: 1,
        items: [{ type: 'meal', title: '无出处餐厅', payload: { ...schedule('12:00', '13:00'), place: { name: 'x', lat: 35, lng: 135 } } }],
      },
    ]
    const report = evaluatePlanGates(days, coords, true)
    expect(report.hard).toContainEqual(expect.objectContaining({ gate: 'provenance', itemTitle: '无出处餐厅' }))
  })

  it('范围：transit 行与带 pointId 的 point 条目即使带 payload.place 也不做出处检查', () => {
    const days: GateDayInput[] = [
      {
        dayIndex: 1,
        items: [
          { type: 'point', pointId: 'p1', title: 'A', payload: schedule('09:00', '10:00') },
          // transit 行携带不完整 place（历史数据残留）：不触发出处门
          { type: 'transit', title: 'A → B', payload: { transport: { mode: 'walk', durationMin: 8, provider: 'google' }, place: { name: 'x', lat: 35, lng: 135 } } },
          // 带 pointId 的 point 同时残留 place：出处交给保存前的专校验，gate 不重复检查
          { type: 'point', pointId: 'p2', title: 'B', payload: { ...schedule('10:20', '11:20'), place: { name: 'x', lat: 35, lng: 135 } } },
        ],
      },
    ]
    const report = evaluatePlanGates(days, coords, true)
    expect(report.hard.filter((f) => f.gate === 'provenance')).toHaveLength(0)
  })

  it('反例：transport.estimated=true 但 provider≠estimate → hard；正例：estimated=true+provider=estimate 通过', () => {
    const days: GateDayInput[] = [
      {
        dayIndex: 1,
        items: [
          { type: 'point', pointId: 'p1', title: 'A', payload: schedule('09:00', '10:00') },
          transit({ estimated: true }),
          { type: 'point', pointId: 'p2', title: 'B', payload: schedule('10:20', '11:20') },
        ],
      },
    ]
    const report = evaluatePlanGates(days, coords, true)
    expect(report.hard).toContainEqual(expect.objectContaining({ gate: 'provenance', itemTitle: 'A → B' }))

    const okDays: GateDayInput[] = [
      {
        dayIndex: 1,
        items: [
          { type: 'point', pointId: 'p1', title: 'A', payload: schedule('09:00', '10:00') },
          transit({ estimated: true, provider: 'estimate' }),
          { type: 'point', pointId: 'p2', title: 'B', payload: schedule('10:20', '11:20') },
        ],
      },
    ]
    expect(evaluatePlanGates(okDays, coords, true).hard).toHaveLength(0)
  })
})

describe('evaluatePlanGates 密度门（soft）', () => {
  it('反例：单日可到访条目 2 个 → soft 但允许通过', () => {
    const report = evaluatePlanGates([healthyDay()], coords, true)
    expect(report.soft).toContainEqual(expect.objectContaining({ gate: 'density', severity: 'soft', dayIndex: 1 }))
    expect(report.passed).toBe(true)
  })

  it('正例：单日 3–9 个可到访条目不触发；>9 触发', () => {
    const items = healthyDay().items.slice(0, 2) // p1 + transit
    const day: GateDayInput = {
      dayIndex: 1,
      items: [
        ...items,
        ...['c', 'd'].map((t, i) => ({ type: 'point' as const, pointId: 'p2', title: t, payload: schedule(`1${i}:00`, `1${i}:30`) })),
      ],
    }
    // 4 个可到访条目：p1, p2(c), p2(d) 3 个 + 上面的 transit → 3 visit? p1 + c + d = 3
    const okReport = evaluatePlanGates([day], coords, true)
    expect(okReport.soft.filter((f) => f.gate === 'density')).toHaveLength(0)

    const dense: GateDayInput = {
      dayIndex: 1,
      items: Array.from({ length: 10 }, (_, i) => ({
        type: 'point',
        pointId: 'p1',
        title: `点${i + 1}`,
        payload: schedule('09:00', '09:30'),
      })),
    }
    const denseReport = evaluatePlanGates([dense], coords, true)
    expect(denseReport.soft).toContainEqual(expect.objectContaining({ gate: 'density' }))
  })
})

describe('evaluatePlanGates 图片门（soft）', () => {
  it('反例：有图比例 < 0.8 → soft；media 或点位 image 均算有图', () => {
    // p1/p2 有 image，p3 无 image 且无 media → 2/3 < 0.8
    const days: GateDayInput[] = [
      {
        dayIndex: 1,
        items: [
          { type: 'point', pointId: 'p1', title: 'A', payload: schedule('09:00', '09:30') },
          transit(),
          { type: 'point', pointId: 'p2', title: 'B', payload: schedule('10:00', '10:30') },
          transit(),
          { type: 'point', pointId: 'p3', title: 'C', payload: schedule('11:00', '11:30') },
        ],
      },
    ]
    const report = evaluatePlanGates(days, coords, true)
    expect(report.soft).toContainEqual(expect.objectContaining({ gate: 'media' }))
    expect(report.stats.withMedia).toBe(2)

    // p3 补上 media 后比例回到 3/3 → 不触发
    const withMedia = structuredClone(days)
    ;(withMedia[0].items[4].payload as Record<string, unknown>).media = { displayUrl: '/img/c.jpg' }
    const okReport = evaluatePlanGates(withMedia, coords, true)
    expect(okReport.soft.filter((f) => f.gate === 'media')).toHaveLength(0)
    expect(okReport.stats.withMedia).toBe(3)
  })
})

describe('evaluatePlanGates 估算门（soft）', () => {
  it('反例：估算段占比 > 0.6 → soft', () => {
    const days: GateDayInput[] = [
      {
        dayIndex: 1,
        items: [
          { type: 'point', pointId: 'p1', title: 'A', payload: schedule('09:00', '09:30') },
          transit({ estimated: true, provider: 'estimate' }),
          { type: 'point', pointId: 'p2', title: 'B', payload: schedule('10:00', '10:30') },
          transit({ estimated: true, provider: 'estimate' }),
          { type: 'point', pointId: 'p1', title: 'C', payload: schedule('11:00', '11:30') },
        ],
      },
    ]
    const report = evaluatePlanGates(days, coords, true)
    expect(report.soft).toContainEqual(expect.objectContaining({ gate: 'estimate_ratio' }))
    expect(report.passed).toBe(true)
  })

  it('正例：全部真实交通（0 估算 / 2 段）不触发', () => {
    const report = evaluatePlanGates(
      [
        {
          dayIndex: 1,
          items: [
            { type: 'point', pointId: 'p1', title: 'A', payload: schedule('09:00', '09:30') },
            transit(),
            { type: 'point', pointId: 'p2', title: 'B', payload: schedule('10:00', '10:30') },
          ],
        },
      ],
      coords,
      true,
    )
    expect(report.soft.filter((f) => f.gate === 'estimate_ratio')).toHaveLength(0)
  })
})

describe('evaluatePlanGates stats 计数', () => {
  it('跨天累计：visitItems/withCoords/withMedia/transitLegs/real/estimated/missingTransit', () => {
    const days: GateDayInput[] = [
      {
        dayIndex: 1,
        items: [
          { type: 'point', pointId: 'p1', title: 'A', payload: schedule('09:00', '09:30') },
          transit(),
          { type: 'point', pointId: 'p2', title: 'B', payload: schedule('10:00', '10:30') },
          transit({ estimated: true, provider: 'estimate' }),
          { type: 'point', pointId: 'p3', title: 'C', payload: schedule('11:00', '11:30') },
        ],
      },
      {
        dayIndex: 2,
        items: [
          { type: 'point', pointId: 'p1', title: 'D', payload: schedule('09:00', '09:30') },
          // 缺交通（hard）
          { type: 'point', pointId: 'p2', title: 'E', payload: schedule('10:00', '10:30') },
        ],
      },
    ]
    const report = evaluatePlanGates(days, coords, true)
    expect(report.stats).toMatchObject({
      visitItems: 5,
      withCoords: 5,
      withMedia: 4, // p3 无 image
      transitLegs: 2,
      transitReal: 1,
      transitEstimated: 1,
      missingTransit: 1,
    })
    expect(report.evaluatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    // 交通缺口是 soft：不再让整份报告失败
    expect(report.passed).toBe(true)
  })
})
