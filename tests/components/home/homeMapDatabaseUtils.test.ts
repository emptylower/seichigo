import { describe, expect, it } from 'vitest'
import homeMapWorldJson from '@/content/generated/home-map-world.json'
import {
  estimateMapLabelWidth,
  formatRoundedTotal,
  mapDbSubtitle,
  mapInsetCardRect,
  mapInsetPointTitle,
  mapLabelRect,
  MAP_LABEL_ANCHOR_TRANSFORM,
  MAP_LABEL_GAP,
  placeMapLabels,
  placeWorldMapLabels,
  rectsOverlap,
  roundDownToThousands,
} from '@/components/home/homeMapDatabaseUtils'
import { parseHomeMapWorld } from '@/lib/home/mapWorld'
import { mapWorldFixture } from './fixtures'

describe('roundDownToThousands / formatRoundedTotal', () => {
  it('向下取整到千位：50597 → 50000，千分位按 locale 格式化', () => {
    expect(roundDownToThousands(50597)).toBe(50000)
    expect(roundDownToThousands(999)).toBe(0)
    expect(roundDownToThousands(1000)).toBe(1000)
    expect(formatRoundedTotal(50597, 'zh')).toBe('50,000')
    expect(formatRoundedTotal(50597, 'en')).toBe('50,000')
    expect(formatRoundedTotal(50597, 'ja')).toBe('50,000')
  })

  it('脏数据兜底：负数/NaN/Infinity 都归 0，绝不把奇怪数字渲染出去', () => {
    expect(roundDownToThousands(-5)).toBe(0)
    expect(roundDownToThousands(Number.NaN)).toBe(0)
    expect(roundDownToThousands(Number.POSITIVE_INFINITY)).toBe(0)
    expect(formatRoundedTotal(-5, 'zh')).toBe('0')
  })
})

describe('mapDbSubtitle', () => {
  it('有 stats 时替换 {works} 占位（数字千分位），不再出现城市数', () => {
    expect(mapDbSubtitle('zh', { works: 1234 })).toBe('来自 1,234 部动漫作品 · 每天都在增加')
    expect(mapDbSubtitle('en', { works: 1234 })).toContain('1,234 anime series')
    expect(mapDbSubtitle('ja', { works: 1234 })).toContain('1,234 作品から')
  })

  it('stats 缺失或 works 为 0 时只保留「每天都在增加」小节，不漏占位符', () => {
    expect(mapDbSubtitle('zh', null)).toBe('每天都在增加')
    expect(mapDbSubtitle('zh', undefined)).toBe('每天都在增加')
    expect(mapDbSubtitle('zh', { works: 0 })).toBe('每天都在增加')
    expect(mapDbSubtitle('en', null)).toBe('Growing every day')
    expect(mapDbSubtitle('ja', null)).toBe('毎日増えています')
  })
})

describe('placeWorldMapLabels（静态世界地图标签）', () => {
  const world = mapWorldFixture()

  it('经纬度按 bounds 换算成百分比坐标（东京 ≈ 合同里的世界位置）', () => {
    const placed = placeWorldMapLabels(world.labels, world.image.bounds, 1208, 441, 'zh')
    const tokyo = placed.find((label) => label.key === 'tokyo')!
    // (139.69+22)/345 ≈ 46.87%，(74-35.69)/126 ≈ 30.40%
    expect(tokyo.xPct).toBeCloseTo(46.87, 1)
    expect(tokyo.yPct).toBeCloseTo(30.4, 1)
  })

  it('四方位回退：东京占上方，京都退到下方，海外标签（伦敦/首尔/洛杉矶）全部保留', () => {
    const placed = placeWorldMapLabels(world.labels, world.image.bounds, 1208, 441, 'zh')
    expect(placed.map((label) => label.key)).toEqual(['tokyo', 'kyoto', 'london', 'los-angeles', 'seoul'])
    const anchorOf = (key: string) => placed.find((label) => label.key === key)!.anchor
    expect(anchorOf('tokyo')).toBe('top')
    expect(anchorOf('kyoto')).toBe('bottom')
    expect(anchorOf('london')).toBe('top')
    // 洛杉矶四个方位里上/右/下都撞上右上角小卡，只能放左侧
    expect(anchorOf('los-angeles')).toBe('left')
    // 首尔与东京/京都矩形相交，退到左侧
    expect(anchorOf('seoul')).toBe('left')
  })

  it('保留 primary 标记、按 locale 取名与千分位数字', () => {
    const placed = placeWorldMapLabels(world.labels, world.image.bounds, 1208, 441, 'en')
    const tokyo = placed.find((label) => label.key === 'tokyo')!
    expect(tokyo.primary).toBe(true)
    expect(tokyo.name).toBe('Tokyo')
    expect(tokyo.countText).toBe('13,959')
    const seoul = placed.find((label) => label.key === 'seoul')!
    expect(seoul.primary).toBe(false)
    expect(seoul.name).toBe('Seoul')
  })

  it('真实数据（content/generated/home-map-world.json）：桌面至少放下目标清单里的 9 个城市', () => {
    const world = parseHomeMapWorld(homeMapWorldJson)
    expect(world).not.toBeNull()
    const placed = placeWorldMapLabels(world!.labels, world!.image.bounds, 1208, 441, 'zh')
    const keys = new Set(placed.map((label) => label.key))
    // B-2 目标：东京、京都或大阪、首尔或上海、伦敦、巴黎、香港、新加坡、洛杉矶、纽约、悉尼 ≥ 9
    const hits = [
      keys.has('tokyo'),
      keys.has('kyoto') || keys.has('osaka'),
      keys.has('seoul') || keys.has('shanghai'),
      keys.has('london'),
      keys.has('paris'),
      keys.has('hongkong'),
      keys.has('singapore'),
      keys.has('los-angeles'),
      keys.has('new-york'),
      keys.has('sydney'),
    ].filter(Boolean).length
    expect(hits).toBeGreaterThanOrEqual(9)
    expect(keys.has('seoul') || keys.has('shanghai')).toBe(true)
    expect(keys.has('paris') || keys.has('venice')).toBe(true)
  })
})

describe('城市标签碰撞规避（四方位回退，B-2）', () => {
  it('估计宽度：CJK 全角比 ASCII 宽，padding 余量 16', () => {
    expect(estimateMapLabelWidth('ab')).toBe(16 + 14)
    expect(estimateMapLabelWidth('東京')).toBe(16 + 24)
    expect(estimateMapLabelWidth('东京 4,210')).toBeGreaterThan(estimateMapLabelWidth('Tokyo 4,210') - 30)
  })

  it('rectsOverlap：相交判定', () => {
    const a = { left: 0, top: 0, right: 10, bottom: 10 }
    expect(rectsOverlap(a, { left: 5, top: 5, right: 15, bottom: 15 })).toBe(true)
    expect(rectsOverlap(a, { left: 20, top: 0, right: 30, bottom: 10 })).toBe(false)
    expect(rectsOverlap(a, { left: 0, top: 20, right: 10, bottom: 30 })).toBe(false)
  })

  it('标签矩形四个锚位：上=上方居中、右=右侧居中、下=下方居中、左=左侧居中（各留 MAP_LABEL_GAP）', () => {
    expect(mapLabelRect(100, 100, 80, 'top', 26)).toEqual({ left: 60, top: 100 - 8 - 26, right: 140, bottom: 92 })
    expect(mapLabelRect(100, 100, 80, 'right', 26)).toEqual({ left: 108, top: 87, right: 188, bottom: 113 })
    expect(mapLabelRect(100, 100, 80, 'bottom', 26)).toEqual({ left: 60, top: 108, right: 140, bottom: 134 })
    expect(mapLabelRect(100, 100, 80, 'left', 26)).toEqual({ left: 12, top: 87, right: 92, bottom: 113 })
    // 缺省锚位是 top（与 B-1 行为一致）
    expect(mapLabelRect(100, 100, 80, 'top', 26)).toEqual(mapLabelRect(100, 100, 80))
  })

  it('上方被占时依次回退到右/下/左，取第一个不相交的锚位', () => {
    const placed = placeMapLabels([
      { key: 'tokyo', x: 100, y: 100, width: 80 },
      // 与 tokyo 的上方矩形相交 → 回退到右侧
      { key: 'right', x: 150, y: 100, width: 60 },
      // 上方撞 tokyo、右侧撞 right → 回退到下方
      { key: 'bottom', x: 100, y: 105, width: 80 },
    ])
    expect(placed.map((p) => [p.key, p.anchor])).toEqual([
      ['tokyo', 'top'],
      ['right', 'right'],
      ['bottom', 'bottom'],
    ])
  })

  it('四个锚位都相交才跳过', () => {
    // 用 occupied 把 (100,100) 的四个锚位矩形分别堵死
    const blocked = placeMapLabels(
      [{ key: 'trapped', x: 100, y: 100, width: 60 }],
      [
        { left: 70, top: 60, right: 130, bottom: 92 }, // 堵 top {70,66,130,92}
        { left: 108, top: 87, right: 168, bottom: 113 }, // 堵 right
        { left: 70, top: 108, right: 130, bottom: 134 }, // 堵 bottom
        { left: 32, top: 87, right: 92, bottom: 113 }, // 堵 left
      ],
    )
    expect(blocked).toEqual([])
    // 对照：没有占用时同一点放得上（top）
    expect(placeMapLabels([{ key: 'free', x: 100, y: 100, width: 60 }]).map((p) => p.anchor)).toEqual(['top'])
  })

  it('occupied 预置矩形参与碰撞：落在右上角小卡矩形内的标签四方位都试不出来 → 跳过', () => {
    const card = mapInsetCardRect(1208)
    // 小卡矩形中心附近的一个点（真实数据里纽约的位置）
    const placed = placeMapLabels([{ key: 'new-york', x: 1078, y: 116, width: 66 }], [card])
    expect(placed).toEqual([])
    // 矩形外的正常标签不受影响
    const ok = placeMapLabels([{ key: 'sydney', x: 606, y: 377, width: 59 }], [card])
    expect(ok.map((p) => [p.key, p.anchor])).toEqual([['sydney', 'top']])
  })

  it('mapInsetCardRect：钉在地图卡片右上角并溢出边缘（-right-6 -top-8，300×300）', () => {
    expect(mapInsetCardRect(1208)).toEqual({ left: 932, top: -32, right: 1232, bottom: 268 })
  })

  it('锚位 transform 与 CSS 偏移一一对应（MAP_LABEL_GAP = 8）', () => {
    expect(MAP_LABEL_GAP).toBe(8)
    expect(MAP_LABEL_ANCHOR_TRANSFORM.top).toBe('translate(-50%, calc(-100% - 8px))')
    expect(MAP_LABEL_ANCHOR_TRANSFORM.right).toBe('translate(8px, -50%)')
    expect(MAP_LABEL_ANCHOR_TRANSFORM.bottom).toBe('translate(-50%, 8px)')
    expect(MAP_LABEL_ANCHOR_TRANSFORM.left).toBe('translate(calc(-100% - 8px), -50%)')
  })
})

describe('mapInsetPointTitle（放大预览小卡点位名，B-2）', () => {
  it('「作品名・点位名」拆成 点位名 + 作品名', () => {
    expect(mapInsetPointTitle('你的名字・须贺神社男坂')).toEqual({ pointName: '须贺神社男坂', workName: '你的名字' })
    expect(mapInsetPointTitle('玲芽之旅・皇居外苑')).toEqual({ pointName: '皇居外苑', workName: '玲芽之旅' })
  })

  it('没有「・」或任一侧为空时原样显示标题', () => {
    expect(mapInsetPointTitle('须贺神社男坂')).toEqual({ pointName: '须贺神社男坂', workName: null })
    expect(mapInsetPointTitle('・须贺神社男坂')).toEqual({ pointName: '・须贺神社男坂', workName: null })
    expect(mapInsetPointTitle('你的名字・')).toEqual({ pointName: '你的名字・', workName: null })
  })
})
