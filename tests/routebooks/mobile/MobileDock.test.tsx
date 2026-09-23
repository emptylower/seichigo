import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MobileDock } from '@/app/(authed)/me/routebooks/[id]/components/mobile/MobileDock'
import type { DayRecord } from '@/app/(authed)/me/routebooks/[id]/types'
import { buildDayTargets, type NavTarget } from '@/lib/route/navigationTargets'

const NAV_TARGETS = buildDayTargets(
  [
    { lat: 35.68, lng: 139.76, name: 'A' },
    { lat: 35.69, lng: 139.7, name: 'B' },
  ],
  'transit'
)

const DAY: DayRecord = {
  id: 'day1',
  routeBookId: 'rb1',
  dayIndex: 1,
  date: null,
  title: null,
  defaultTravelMode: 'transit',
}

function renderDock(overrides: Partial<Parameters<typeof MobileDock>[0]> = {}) {
  const props = {
    selectedDay: DAY as DayRecord | null,
    movableCount: 3,
    navTargets: NAV_TARGETS as NavTarget[],
    routeBookId: 'rb1',
    selectedDayIndex: 1 as number | null,
    hasDates: true,
    canStart: true,
    startLabel: '开始 Day 1',
    needsDayPick: false,
    onOpenPool: vi.fn(),
    onOptimize: vi.fn(),
    onOpenDayPicker: vi.fn(),
    onStart: vi.fn(),
    locale: 'zh' as const,
    ...overrides,
  }
  const view = render(<MobileDock {...props} />)
  return { props, ...view }
}

describe('MobileDock 优化按钮', () => {
  it('可移动点 < 2 时禁用；≥2 时可用并调 onOptimize', () => {
    const { props, rerender } = renderDock({ movableCount: 1 })
    const optimizeButton = screen.getByRole('button', { name: /优化/ })
    expect(optimizeButton).toBeDisabled()

    rerender(<MobileDock {...props} movableCount={2} />)
    expect(screen.getByRole('button', { name: /优化/ })).not.toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /优化/ }))
    expect(props.onOptimize).toHaveBeenCalledTimes(1)
  })

  it('未选天（全部/未安排）时优化禁用', () => {
    renderDock({ selectedDay: null, movableCount: 5 })
    expect(screen.getByRole('button', { name: /优化/ })).toBeDisabled()
  })
})

describe('MobileDock 开始按钮', () => {
  it('无日期行程（needsDayPick）点「开始」打开选天 sheet，不直接开始', () => {
    const { props } = renderDock({ needsDayPick: true, startLabel: '开始导航' })
    fireEvent.click(screen.getByRole('button', { name: /开始导航/ }))
    expect(props.onOpenDayPicker).toHaveBeenCalledTimes(1)
    expect(props.onStart).not.toHaveBeenCalled()
  })

  it('已选定有日期的天：直接调 onStart', () => {
    const { props } = renderDock({ needsDayPick: false })
    fireEvent.click(screen.getByRole('button', { name: /开始 Day 1/ }))
    expect(props.onStart).toHaveBeenCalledTimes(1)
    expect(props.onOpenDayPicker).not.toHaveBeenCalled()
  })

  it('canStart=false 时开始禁用', () => {
    renderDock({ canStart: false })
    expect(screen.getByRole('button', { name: /开始 Day 1/ })).toBeDisabled()
  })
})

describe('MobileDock 打开导航', () => {
  it('未选天禁用；选了天有目标时 sheet 含 Google / Apple / 高德三项', () => {
    const { rerender, props } = renderDock({ selectedDay: null, navTargets: [] })
    expect(screen.getByRole('button', { name: '打开导航' })).toBeDisabled()

    rerender(<MobileDock {...props} selectedDay={DAY} navTargets={NAV_TARGETS} />)
    fireEvent.click(screen.getByRole('button', { name: '打开导航' }))
    expect(screen.getByRole('link', { name: /Google 地图/ }).getAttribute('href')).toContain('google.com/maps/dir')
    expect(screen.getByRole('link', { name: /Apple 地图/ }).getAttribute('href')).toContain('maps.apple.com')
    expect(screen.getByRole('link', { name: /高德地图/ }).getAttribute('href')).toContain('amap.com')
  })

  it('选了天但当天无导航目标：仍可打开 sheet 切换交通方式，不列地图（G5）', () => {
    const onChangeTravelMode = vi.fn()
    renderDock({ navTargets: [], onChangeTravelMode })
    const trigger = screen.getByRole('button', { name: '打开导航' })
    expect(trigger).not.toBeDisabled()
    fireEvent.click(trigger)
    expect(screen.getByRole('radiogroup', { name: '当天默认交通方式' })).toBeTruthy()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.getByText('这一天还没有可导航的站点')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: '步行' }))
    expect(onChangeTravelMode).toHaveBeenCalledWith('walking')
  })
})

describe('MobileDock 更多：导出', () => {
  it('更多 sheet 给 GPX 整程 / 当天 / ICS 下载链接', () => {
    renderDock()
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    expect(screen.getByRole('link', { name: /GPX（整个行程）/ }).getAttribute('href')).toBe(
      '/api/me/routebooks/rb1/export.gpx?scope=all'
    )
    expect(screen.getByRole('link', { name: /GPX（Day 1）/ }).getAttribute('href')).toBe(
      '/api/me/routebooks/rb1/export.gpx?scope=day&dayIndex=1'
    )
    expect(screen.getByRole('link', { name: /日历（ICS）/ })).toHaveAttribute('download')
  })

  it('无日期行程 ICS 不可点并提示；未选天不给当天 GPX', () => {
    renderDock({ hasDates: false, selectedDayIndex: null })
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    expect(screen.queryByRole('link', { name: /日历/ })).toBeNull()
    expect(screen.getByText('行程没有日期，无法导出日历')).toBeTruthy()
    expect(screen.queryByText(/GPX（Day/)).toBeNull()
  })
})

describe('MobileDock 导航 sheet 交通方式 / 无障碍文案（B3 修复）', () => {
  it('导航 sheet 内切换当天默认交通方式调 onChangeTravelMode', () => {
    const onChangeTravelMode = vi.fn()
    renderDock({ onChangeTravelMode })
    fireEvent.click(screen.getByRole('button', { name: '打开导航' }))
    const group = screen.getByRole('radiogroup', { name: '当天默认交通方式' })
    expect(screen.getByRole('radio', { name: '公共交通' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: '步行' }))
    expect(onChangeTravelMode).toHaveBeenCalledWith('walking')
    // 点当前方式不重复提交
    fireEvent.click(screen.getByRole('radio', { name: '公共交通' }))
    expect(onChangeTravelMode).toHaveBeenCalledTimes(1)
    expect(group).toBeTruthy()
  })

  it('dock 标签与禁用原因按 locale（英文用半角括号）', () => {
    renderDock({ selectedDay: null, locale: 'en' })
    expect(screen.getByRole('navigation', { name: 'Trip actions' })).toBeTruthy()
    const optimize = screen.getAllByRole('button').find((btn) => btn.hasAttribute('disabled') && btn.getAttribute('aria-label')?.includes('('))
    expect(optimize).toBeTruthy()
    expect(optimize?.getAttribute('aria-label')).not.toMatch(/[（）]/)
  })
})
