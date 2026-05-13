import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { JournalCover } from '@/app/(authed)/me/journal/components/JournalCover'
import type { JournalSnapshot } from '@/lib/journal/types'

const baseSnap: JournalSnapshot = {
  user: {
    id: 'u1',
    name: 'Lily',
    image: null,
    bio: '想把每一部喜欢的动画都走一遍',
    createdAt: new Date('2024-10-04'),
    journalNumber: '#0042',
    daysSinceJoined: 218,
  },
  stats: {
    worksVisited: 5,
    pointsVisited: 47,
    totalCheckins: 156,
    totalKilometers: 1247,
    totalTrips: 8,
  },
  currentTrip: {
    id: 'rb-clannad',
    title: '京都 · CLANNAD 之旅',
    pointCount: 12,
    durationDays: 5,
    departureDate: new Date('2025-04-12'),
    status: 'preparing',
  },
  prefectures: [],
  pinsForMap: [],
  recentNotes: [],
  tripsForTimeline: [],
  workProgress: [],
  achievements: [],
  nextAchievement: null,
  travelModeBreakdown: [],
  recentPhotos: [],
}

describe('JournalCover', () => {
  it('renders user name and VOL.01 marker', () => {
    const { getByText } = render(<JournalCover snapshot={baseSnap} />)
    expect(getByText(/Lily 的手帐/)).toBeTruthy()
    expect(getByText(/VOL\. 01 · 第 218 天/)).toBeTruthy()
  })

  it('renders all 5 stat numbers with labels', () => {
    const { getByText } = render(<JournalCover snapshot={baseSnap} />)
    expect(getByText('5')).toBeTruthy()
    expect(getByText('47')).toBeTruthy()
    expect(getByText('156')).toBeTruthy()
    expect(getByText('1,247')).toBeTruthy()
    expect(getByText('8')).toBeTruthy()
    expect(getByText('部作品')).toBeTruthy()
    expect(getByText('取景地')).toBeTruthy()
    expect(getByText('次打卡')).toBeTruthy()
    expect(getByText('公里')).toBeTruthy()
    expect(getByText('次行程')).toBeTruthy()
  })

  it('renders the current trip card with title and departure date', () => {
    const { getByText } = render(<JournalCover snapshot={baseSnap} />)
    expect(getByText('京都 · CLANNAD 之旅')).toBeTruthy()
    expect(getByText(/出发日 2025-04-12/)).toBeTruthy()
  })

  it('omits current trip card when snapshot.currentTrip is null', () => {
    const { queryByText } = render(
      <JournalCover snapshot={{ ...baseSnap, currentTrip: null }} />,
    )
    expect(queryByText('京都 · CLANNAD 之旅')).toBeNull()
    expect(queryByText('正在准备的行程')).toBeNull()
  })

  it('uses fallback name when user.name is missing', () => {
    const snap = { ...baseSnap, user: { ...baseSnap.user, name: '巡礼者' } }
    const { getByText } = render(<JournalCover snapshot={snap} />)
    expect(getByText(/巡礼者 的手帐/)).toBeTruthy()
  })
})
