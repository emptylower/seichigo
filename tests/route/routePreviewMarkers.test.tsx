import { describe, it, expect } from 'vitest'
import {
  MARKER_ACTIVE_CLASS,
  applyMarkerActive,
  buildMarkerLayouts,
  createNumberedMarker,
  markerInnerElement,
  markerOptionsFor,
} from '@/components/route/routePreviewMarkers'

function makeLayout(overrides: Partial<Parameters<typeof createNumberedMarker>[0]> = {}) {
  return {
    id: 'point|115908:uji|宇治桥',
    lat: 34.8892,
    lng: 135.8075,
    label: '1',
    title: '宇治桥',
    offsetX: 0,
    offsetY: 0,
    overlapCount: 1,
    ...overrides,
  }
}

describe('routePreviewMarkers（marker ↔ 条目联动）', () => {
  it('createNumberedMarker：元素含 data-point-id 与序号文本', () => {
    const layout = makeLayout()
    const el = createNumberedMarker(layout, { color: '#e11d48' })
    expect(el.dataset.pointId).toBe('point|115908:uji|宇治桥')
    expect(el.textContent).toBe('1')
    expect(el.title).toContain('宇治桥')
  })

  it('createNumberedMarker active=true：初始即高亮态', () => {
    const el = createNumberedMarker(makeLayout(), { color: '#e11d48', active: true })
    expect(el.classList.contains(MARKER_ACTIVE_CLASS)).toBe(true)
  })

  it('L15：clickable=false 时不加 cursor:pointer（无可点击语义）；缺省/true 保持 pointer', () => {
    const nonClickable = createNumberedMarker(makeLayout(), { color: '#e11d48', clickable: false })
    expect(nonClickable.style.cursor).not.toBe('pointer')

    const clickable = createNumberedMarker(makeLayout(), { color: '#e11d48', clickable: true })
    expect(clickable.style.cursor).toBe('pointer')
    const legacyDefault = createNumberedMarker(makeLayout(), { color: '#e11d48' })
    expect(legacyDefault.style.cursor).toBe('pointer')
  })

  it('R1：根元素的 transform 永远交给 maplibre（创建与 active 切换都不写）', () => {
    const el = createNumberedMarker(makeLayout({ offsetX: 6, offsetY: -4 }), { color: '#e11d48' })
    expect(el.style.transform).toBe('')
    expect(el.style.left).toBe('')
    expect(el.style.top).toBe('')

    applyMarkerActive(el, true)
    expect(el.style.transform).toBe('')
    applyMarkerActive(el, false)
    expect(el.style.transform).toBe('')

    const activeAtCreate = createNumberedMarker(makeLayout({ offsetX: 6, offsetY: -4 }), {
      color: '#e11d48',
      active: true,
    })
    expect(activeAtCreate.style.transform).toBe('')
  })

  it('applyMarkerActive 切换 class 与内联样式（内层放大/主色填充、根 z-index），可逆', () => {
    const el = createNumberedMarker(makeLayout({ offsetX: 6, offsetY: -4 }), { color: '#e11d48' })
    const inner = markerInnerElement(el)
    expect(inner).not.toBe(el)
    expect(el.classList.contains(MARKER_ACTIVE_CLASS)).toBe(false)
    expect(inner.style.transform).not.toContain('scale')

    applyMarkerActive(el, true)
    expect(el.classList.contains(MARKER_ACTIVE_CLASS)).toBe(true)
    expect(inner.style.transform).toContain('scale(1.25)')
    expect(inner.style.backgroundColor).toBe('rgb(225, 29, 72)')
    expect(inner.style.color).toBe('rgb(255, 255, 255)')
    expect(Number(el.style.zIndex)).toBeGreaterThan(0)

    applyMarkerActive(el, false)
    expect(el.classList.contains(MARKER_ACTIVE_CLASS)).toBe(false)
    expect(inner.style.transform).not.toContain('scale')
    expect(inner.style.backgroundColor).toBe('rgb(255, 255, 255)')
  })

  it('markerOptionsFor：重叠错位通过 maplibre Marker 的 offset 传递（不是自写 transform）', () => {
    const layouts = buildMarkerLayouts([
      { id: 'a', lat: 34.8892, lng: 135.8075, label: '1' },
      { id: 'b', lat: 34.88921, lng: 135.80751, label: '2' },
    ])
    const options = markerOptionsFor(layouts[0]!)
    expect(options.offset).toEqual([layouts[0]!.offsetX, layouts[0]!.offsetY])
    expect(markerOptionsFor(buildMarkerLayouts([{ id: 'c', lat: 1, lng: 2, label: '1' }])[0]!).offset).toEqual([0, 0])
  })

  it('buildMarkerLayouts：保留 id/label；重叠点位散开', () => {
    const layouts = buildMarkerLayouts([
      { id: 'a', lat: 34.8892, lng: 135.8075, label: '1' },
      { id: 'b', lat: 34.88921, lng: 135.80751, label: '2' },
      { id: 'c', lat: 35.6329, lng: 139.8804, label: '3' },
    ])
    expect(layouts.map((l) => l.id)).toEqual(['a', 'b', 'c'])
    expect(layouts[0]!.overlapCount).toBe(2)
    expect(layouts[1]!.overlapCount).toBe(2)
    expect(layouts[2]!.overlapCount).toBe(1)
    expect(layouts[0]!.offsetX !== 0 || layouts[0]!.offsetY !== 0).toBe(true)
    expect(layouts[2]!.offsetX).toBe(0)
    expect(layouts[2]!.offsetY).toBe(0)
  })
})
