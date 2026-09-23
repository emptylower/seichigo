import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ExportMenu, buildExportEntries } from '@/app/(authed)/me/routebooks/[id]/components/ExportMenu'

describe('buildExportEntries', () => {
  it('选中天给当天 GPX；有日期 ICS 可用', () => {
    const entries = buildExportEntries('rb 1', 2, true, 'zh')
    expect(entries.map((entry) => [entry.key, entry.href])).toEqual([
      ['gpxAll', '/api/me/routebooks/rb%201/export.gpx?scope=all'],
      ['gpxDay', '/api/me/routebooks/rb%201/export.gpx?scope=day&dayIndex=2'],
      ['ics', '/api/me/routebooks/rb%201/export.ics'],
    ])
  })

  it('未选天不给当天项；无日期 ICS 禁用并带原因', () => {
    const entries = buildExportEntries('rb1', null, false, 'en')
    expect(entries.map((entry) => entry.key)).toEqual(['gpxAll', 'ics'])
    expect(entries[1]).toMatchObject({ href: null, hint: 'Set trip dates to export a calendar' })
  })
})

describe('ExportMenu（桌面侧栏「导出 ▾」）', () => {
  it('展开后是下载链接菜单，ICS 无日期时不可点', () => {
    render(<ExportMenu routeBookId="rb1" selectedDayIndex={1} hasDates={false} locale="zh" />)
    fireEvent.click(screen.getByRole('button', { name: /导出/ }))
    const menu = screen.getByRole('menu', { name: '导出行程' })
    const links = within(menu).getAllByRole('menuitem')
    expect(links).toHaveLength(3)
    expect(within(menu).getByRole('menuitem', { name: /GPX（整个行程）/ })).toHaveAttribute('download')
    expect(within(menu).getByRole('menuitem', { name: /日历（ICS）/ })).toHaveAttribute('aria-disabled', 'true')
    // jsdom 不实现下载导航：拦掉默认行为，只验证点选后收起
    menu.addEventListener('click', (event) => event.preventDefault())
    fireEvent.click(within(menu).getByRole('menuitem', { name: /GPX（Day 1）/ }))
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
