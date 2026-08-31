import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DayCards } from '@/app/(authed)/plan/[id]/components/DayCards'
import type { TripPlanView } from '@/lib/tripPlan/view'

const plan: TripPlanView = {
  id: 'plan-1',
  title: '京都京吹圣地巡礼',
  status: 'draft',
  startDate: null,
  dayCount: 2,
  bangumiIds: [115908],
  updatedAt: new Date().toISOString(),
  days: [
    {
      id: 'day-1',
      dayIndex: 1,
      date: null,
      citySlug: 'kyoto',
      summary: '宇治巡礼日',
      items: [
        {
          id: 'item-1',
          sortOrder: 0,
          type: 'point',
          pointId: 'p1',
          timeHint: '上午',
          title: '宇治桥',
          note: null,
          reason: '第 1 集开场取景地',
          payload: null,
          point: { id: 'p1', name: '宇治橋', nameZh: '宇治桥', lat: 34.8892, lng: 135.8075, image: null },
        },
        {
          id: 'item-2',
          sortOrder: 1,
          type: 'transit',
          pointId: null,
          timeHint: null,
          title: 'JR 奈良线',
          note: '约 20 分钟',
          reason: null,
          payload: null,
          point: null,
        },
      ],
    },
    { id: 'day-2', dayIndex: 2, date: null, citySlug: null, summary: null, items: [] },
  ],
}

describe('DayCards', () => {
  it('renders day tabs and items with reason', () => {
    render(<DayCards plan={plan} selectedDay={1} onSelectDay={() => {}} />)
    expect(screen.getByText('Day 1')).toBeTruthy()
    expect(screen.getByText('Day 2')).toBeTruthy()
    expect(screen.getByText('宇治桥')).toBeTruthy()
    expect(screen.getByText('第 1 集开场取景地')).toBeTruthy()
    expect(screen.getByText(/JR 奈良线/)).toBeTruthy()
  })

  it('shows empty state when plan has no days', () => {
    render(<DayCards plan={{ ...plan, days: [] }} selectedDay={1} onSelectDay={() => {}} />)
    expect(screen.getByText(/还没有行程/)).toBeTruthy()
  })
})
