import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { LegConnector } from '@/app/(authed)/me/routebooks/[id]/components/LegConnector'
import type { DayLeg } from '@/app/(authed)/me/routebooks/[id]/types'

function makeLeg(overrides: Partial<DayLeg> = {}): DayLeg {
  return {
    fromId: 'a',
    toId: 'b',
    mode: 'walking',
    durationSec: 720,
    distanceM: 950,
    polyline: null,
    source: 'google',
    ...overrides,
  }
}

describe('LegConnector', () => {
  it('点击连接行弹菜单，选「步行」触发 onChangeLegMode("walking")', () => {
    const onChangeLegMode = vi.fn()
    render(<LegConnector leg={makeLeg()} routeVisible onChangeLegMode={onChangeLegMode} locale="zh" />)

    fireEvent.click(screen.getByRole('button', { name: '修改本段交通方式' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /步行/ }))
    expect(onChangeLegMode).toHaveBeenCalledWith('walking')
  })

  it('选「用当天默认」触发 onChangeLegMode(null)', () => {
    const onChangeLegMode = vi.fn()
    render(
      <LegConnector leg={makeLeg()} routeVisible itemLegMode="driving" onChangeLegMode={onChangeLegMode} locale="zh" />
    )

    fireEvent.click(screen.getByRole('button', { name: '修改本段交通方式' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /用当天默认/ }))
    expect(onChangeLegMode).toHaveBeenCalledWith(null)
  })

  it('heuristic 段显示「估算」，agent 段显示「AI 已查」', () => {
    const { rerender } = render(<LegConnector leg={makeLeg({ source: 'heuristic' })} routeVisible locale="zh" />)
    expect(screen.getByText('估算')).toBeTruthy()
    rerender(<LegConnector leg={makeLeg({ source: 'agent' })} routeVisible locale="zh" />)
    expect(screen.getByText('AI 已查')).toBeTruthy()
  })

  it('未传 onChangeLegMode 时不可点击', () => {
    render(<LegConnector leg={makeLeg()} routeVisible locale="zh" />)
    expect(screen.getByRole('button', { name: '修改本段交通方式' })).toBeDisabled()
  })

  it('agent 段菜单顶部提示「将覆盖 AI 查询结果」，其它来源不提示', () => {
    const { rerender } = render(
      <LegConnector leg={makeLeg({ source: 'agent' })} routeVisible onChangeLegMode={() => {}} locale="zh" />
    )
    // 契约：agent 段菜单可用（服务端允许 legMode 覆盖）
    const trigger = screen.getByRole('button', { name: '修改本段交通方式' })
    expect(trigger).not.toBeDisabled()
    fireEvent.click(trigger)
    expect(screen.getByText('将覆盖 AI 查询结果')).toBeTruthy()

    rerender(<LegConnector leg={makeLeg({ source: 'google' })} routeVisible onChangeLegMode={() => {}} locale="zh" />)
    fireEvent.click(screen.getByRole('button', { name: '修改本段交通方式' }))
    expect(screen.queryByText('将覆盖 AI 查询结果')).toBeNull()
  })
})
