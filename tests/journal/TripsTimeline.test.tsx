import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { TripsTimeline } from '@/app/(authed)/me/journal/components/TripsTimeline'

describe('TripsTimeline', () => {
  it('renders 12 month labels (1月 - 12月)', () => {
    const { getByText } = render(
      <TripsTimeline totalCheckins={156} totalTrips={8} trips={[]} />,
    )
    expect(getByText('1月')).toBeTruthy()
    expect(getByText('12月')).toBeTruthy()
  })

  it('renders one ribbon per trip with title', () => {
    const { getByText } = render(
      <TripsTimeline
        totalCheckins={156}
        totalTrips={1}
        trips={[
          {
            id: 'rb1',
            title: '镰仓·灌篮高手',
            workTitle: '灌篮高手',
            location: '神奈川',
            monthStart: 3,
            monthEnd: 3,
            status: 'completed',
          },
        ]}
      />,
    )
    expect(getByText(/镰仓·灌篮高手/)).toBeTruthy()
  })

  it('uses dashed border for planned trips and solid for completed', () => {
    const { container } = render(
      <TripsTimeline
        totalCheckins={0}
        totalTrips={2}
        trips={[
          { id: 'a', title: 'a', workTitle: null, location: null, monthStart: 4, monthEnd: 4, status: 'planned' },
          { id: 'b', title: 'b', workTitle: null, location: null, monthStart: 6, monthEnd: 6, status: 'completed' },
        ]}
      />,
    )
    const ribbons = container.querySelectorAll('[data-ribbon]')
    expect(ribbons[0].getAttribute('data-status')).toBe('planned')
    expect(ribbons[1].getAttribute('data-status')).toBe('completed')
  })

  it('shows totalCheckins and totalTrips in the header', () => {
    const { getByText } = render(
      <TripsTimeline totalCheckins={156} totalTrips={8} trips={[]} />,
    )
    expect(getByText('156')).toBeTruthy()
    expect(getByText('8')).toBeTruthy()
  })
})
