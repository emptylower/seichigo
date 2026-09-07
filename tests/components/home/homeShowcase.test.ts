import { describe, expect, it } from 'vitest'
import {
  cityDisplayName,
  showcaseCitySlugs,
  showcaseDayDate,
  showcaseItemImage,
  showcaseLodging,
  showcasePointCount,
  showcaseShortTitle,
  showcaseWorks,
  transitLineText,
  visibleDayTimeline,
} from '@/components/home/homeShowcase'
import type { TripPlanDayView, TripPlanItemView } from '@/lib/tripPlan/view'

function item(overrides: Partial<TripPlanItemView> & { id: string }): TripPlanItemView {
  return {
    sortOrder: 0,
    type: 'point',
    pointId: null,
    timeHint: null,
    title: '',
    note: null,
    reason: null,
    payload: null,
    point: null,
    ...overrides,
  } as TripPlanItemView
}

function day(dayIndex: number, items: TripPlanItemView[], citySlug: string | null = 'tokyo'): TripPlanDayView {
  return { id: `d${dayIndex}`, dayIndex, date: null, citySlug, summary: null, items }
}

describe('showcaseShortTitle', () => {
  it('只取「｜」之前的部分；取不到就全量', () => {
    expect(showcaseShortTitle('2026东京圣诞周8日｜天气之子×你的名字 巡礼')).toBe('2026东京圣诞周8日')
    expect(showcaseShortTitle('东京 8 日 | 细分标题')).toBe('东京 8 日')
    expect(showcaseShortTitle('没有分隔符的标题')).toBe('没有分隔符的标题')
  })
})

describe('showcaseWorks', () => {
  it('从 point 标题「作品名・点位名」提取作品名：去重、最多 4 个、非 point 不算', () => {
    const days = [
      day(1, [
        item({ id: 'p1', title: '你的名字・须贺神社男坂' }),
        item({ id: 'm1', type: 'meal', title: '午餐：车屋别馆' }),
        item({ id: 'p2', title: '你的名字・四谷见附桥' }),
        item({ id: 'p3', title: '天气之子・歌舞伎町一番街入口' }),
        item({ id: 'p4', title: '没有间隔号的点位名' }),
        item({ id: 'p5', title: '言叶之庭・新宿御苑' }),
        item({ id: 'p6', title: '孤独摇滚・下北泽' }),
        item({ id: 'p7', title: '间谍过家家・某处' }),
      ]),
    ]
    expect(showcaseWorks(days)).toEqual(['你的名字', '天气之子', '言叶之庭', '孤独摇滚'])
  })

  it('空行程返回空数组', () => {
    expect(showcaseWorks([])).toEqual([])
  })
})

describe('城市名静态表', () => {
  it('slug 去重并保持顺序', () => {
    const days = [day(1, [], 'tokyo'), day(2, [], 'urayasu'), day(3, [], 'tokyo'), day(4, [], null)]
    expect(showcaseCitySlugs(days)).toEqual(['tokyo', 'urayasu'])
  })

  it('表内 slug 出三语名；表外 slug 首字母大写兜底（不查库）', () => {
    expect(cityDisplayName('tokyo', 'zh')).toBe('东京')
    expect(cityDisplayName('tokyo', 'en')).toBe('Tokyo')
    expect(cityDisplayName('tokyo', 'ja')).toBe('東京')
    expect(cityDisplayName('urayasu', 'zh')).toBe('浦安')
    expect(cityDisplayName('fujisawa', 'ja')).toBe('藤沢')
    expect(cityDisplayName('wakanda', 'zh')).toBe('Wakanda')
  })
})

describe('showcasePointCount / showcaseLodging', () => {
  it('point 类型条目计数；住宿剥掉「住宿：」前缀、去重后取第一条', () => {
    const days = [
      day(1, [
        item({ id: 'p1', title: '你的名字・须贺神社男坂' }),
        item({ id: 't1', type: 'transit' }),
        item({ id: 'l1', type: 'lodging', title: '住宿：新宿华盛顿酒店（连续7晚据点）' }),
      ]),
      day(2, [
        item({ id: 'p2', title: '天气之子・歌舞伎町' }),
        item({ id: 'l2', type: 'lodging', title: '住宿：新宿华盛顿酒店（连续7晚据点）' }),
      ]),
    ]
    expect(showcasePointCount(days)).toBe(2)
    expect(showcaseLodging(days)).toBe('新宿华盛顿酒店（连续7晚据点）')
  })

  it('没有住宿时返回 null（该信息行不显示）', () => {
    expect(showcaseLodging([day(1, [item({ id: 'p1' })])])).toBeNull()
  })
})

describe('transitLineText', () => {
  it('walk：「步行 8 分钟 · 0.6 km」', () => {
    const transit = item({
      id: 't1',
      type: 'transit',
      payload: { transport: { mode: 'walk', durationMin: 8, distanceKm: 0.6 } },
    })
    expect(transitLineText(transit, 'zh')).toBe('步行 8 分钟 · 0.6 km')
    expect(transitLineText(transit, 'en')).toBe('Walk 8 min · 0.6 km')
    expect(transitLineText(transit, 'ja')).toBe('徒歩 8 分 · 0.6 km')
  })

  it('train/rail/subway→电车、bus→巴士、其它（如 transit）→交通', () => {
    const train = item({ id: 't', type: 'transit', payload: { transport: { mode: 'rail', durationMin: 33 } } })
    expect(transitLineText(train, 'zh')).toBe('电车 33 分钟')
    const bus = item({ id: 't', type: 'transit', payload: { transport: { mode: 'bus', durationMin: 20 } } })
    expect(transitLineText(bus, 'zh')).toBe('巴士 20 分钟')
    const other = item({ id: 't', type: 'transit', payload: { transport: { mode: 'transit', durationMin: 33 } } })
    expect(transitLineText(other, 'zh')).toBe('交通 33 分钟')
  })

  it('没有 transport 载荷时退成「→」占位；缺 mode 时不编交通方式', () => {
    expect(transitLineText(item({ id: 't', type: 'transit', payload: null }), 'zh')).toBe('→')
    const noMode = item({ id: 't', type: 'transit', payload: { transport: { durationMin: 19 } } })
    expect(transitLineText(noMode, 'zh')).toBe('19 分钟')
  })
})

describe('showcaseDayDate', () => {
  it('ISO 日期格式化为 MM-DD；date 为 null 时不显示第二行', () => {
    expect(showcaseDayDate('2026-12-24')).toBe('12-24')
    expect(showcaseDayDate('2026-01-05T00:00:00.000Z')).toBe('01-05')
    expect(showcaseDayDate(null)).toBeNull()
    expect(showcaseDayDate('不是日期')).toBeNull()
  })
})

describe('visibleDayTimeline', () => {
  it('不超过 6 张卡片时原样返回（transit 随行显示）', () => {
    const items = [
      item({ id: 'p1', sortOrder: 0 }),
      item({ id: 't1', sortOrder: 1, type: 'transit' }),
      item({ id: 'p2', sortOrder: 2 }),
    ]
    const { rows, hiddenCount } = visibleDayTimeline(items)
    expect(rows.map((i) => i.id)).toEqual(['p1', 't1', 'p2'])
    expect(hiddenCount).toBe(0)
  })

  it('第 7 张卡片起折叠：裁在第 6 张卡片后，结尾多余 transit 行去掉，hiddenCount 只数卡片', () => {
    const items = [
      item({ id: 'p1', sortOrder: 0 }),
      item({ id: 't1', sortOrder: 1, type: 'transit' }),
      item({ id: 'p2', sortOrder: 2 }),
      item({ id: 'p3', sortOrder: 3 }),
      item({ id: 'p4', sortOrder: 4 }),
      item({ id: 'p5', sortOrder: 5 }),
      item({ id: 'p6', sortOrder: 6 }),
      item({ id: 't2', sortOrder: 7, type: 'transit' }),
      item({ id: 'p7', sortOrder: 8 }),
      item({ id: 'm1', sortOrder: 9, type: 'meal' }),
    ]
    const { rows, hiddenCount } = visibleDayTimeline(items)
    expect(rows.map((i) => i.id)).toEqual(['p1', 't1', 'p2', 'p3', 'p4', 'p5', 'p6'])
    expect(hiddenCount).toBe(2)
  })

  it('按 sortOrder 排，不信任传入顺序', () => {
    const items = [item({ id: 'p2', sortOrder: 5 }), item({ id: 'p1', sortOrder: 1 })]
    expect(visibleDayTimeline(items).rows.map((i) => i.id)).toEqual(['p1', 'p2'])
  })
})

describe('showcaseItemImage', () => {
  it('media.displayUrl（站内静态化路径）优先，署名一起带出', () => {
    const withMedia = item({
      id: 'm1',
      type: 'meal',
      payload: { media: { displayUrl: '/images/showcase/a.jpg', attribution: '照片：Kenji' } },
      point: { id: 'p', name: 'p', nameZh: 'p', lat: 1, lng: 1, image: 'https://image.anitabi.cn/x.jpg' },
    })
    expect(showcaseItemImage(withMedia)).toEqual({ src: '/images/showcase/a.jpg', attribution: '照片：Kenji' })
  })

  it('只有站外 point.image 时走公开代理（直链会 403）；都没有时用占位块', () => {
    const pointOnly = item({
      id: 'p1',
      point: { id: 'p', name: 'p', nameZh: 'p', lat: 1, lng: 1, image: 'https://image.anitabi.cn/points/1/x.jpg' },
    })
    // node 环境没有 window，代理 URL 用兜底 origin；浏览器里是同源相对路径
    expect(showcaseItemImage(pointOnly).src).toContain('/api/anitabi/image-render')
    expect(showcaseItemImage(item({ id: 'p2' })).src).toBeNull()
  })
})
