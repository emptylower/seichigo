import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WeatherBadge, weatherEmoji } from '@/app/(authed)/me/routebooks/[id]/components/WeatherBadge'

describe('weatherEmoji（WMO code 映射）', () => {
  it.each([
    [0, '☀️'],
    [1, '⛅'],
    [3, '⛅'],
    [45, '🌫️'],
    [48, '🌫️'],
    [51, '🌧️'],
    [61, '🌧️'],
    [67, '🌧️'],
    [71, '❄️'],
    [77, '❄️'],
    [80, '🌦️'],
    [82, '🌦️'],
    [95, '⛈️'],
    [99, '⛈️'],
  ])('code %i → %s', (code, emoji) => {
    expect(weatherEmoji(code)).toBe(emoji)
  })
})

describe('WeatherBadge', () => {
  it('显示「⛅ 22°/15°」并带三语无障碍标签（温度取整）', () => {
    render(<WeatherBadge weather={{ date: '2026-09-25', tMax: 21.6, tMin: 15.2, code: 2 }} locale="zh" />)
    const badge = screen.getByRole('img', { name: '天气：最高 22°，最低 15°' })
    expect(badge.textContent).toBe('⛅22°/15°')
  })

  it('compact 只显示 emoji', () => {
    render(<WeatherBadge weather={{ date: '2026-09-25', tMax: 30, tMin: 24, code: 0 }} locale="en" compact />)
    const badge = screen.getByRole('img', { name: 'Weather: high 30°, low 24°' })
    expect(badge.textContent).toBe('☀️')
  })
})

describe('DayDetailCard 天气位', () => {
  it('没有住宿但有天气时也显示浮卡；无天气无住宿不渲染', async () => {
    const { DayDetailCard } = await import('@/app/(authed)/me/routebooks/[id]/components/DayDetailCard')
    const day = { id: 'd1', routeBookId: 'rb1', dayIndex: 1, date: '2026-09-25T00:00:00.000Z', title: null, defaultTravelMode: 'transit' as const }
    const { rerender, container } = render(
      <DayDetailCard day={day} lodgings={[]} places={[]} weather={{ date: '2026-09-25', tMax: 25, tMin: 18, code: 61 }} locale="zh" />
    )
    expect(screen.getByText('当天天气')).toBeTruthy()
    expect(screen.getByRole('img', { name: '天气：最高 25°，最低 18°' }).textContent).toContain('🌧️')
    rerender(<DayDetailCard day={day} lodgings={[]} places={[]} weather={null} locale="zh" />)
    expect(container.innerHTML).toBe('')
  })
})
