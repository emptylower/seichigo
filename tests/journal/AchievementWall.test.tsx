import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { AchievementWall } from '@/app/(authed)/me/journal/components/AchievementWall'

const NOW = new Date('2025-03-20')

describe('AchievementWall', () => {
  it('renders 8 achievement slots in fixed order', () => {
    const { container } = render(
      <AchievementWall
        achievements={[
          { id: 'first-checkin', label: '首次', sub: '打卡', color: 'seal-red', unlocked: true, unlockedAt: NOW },
          { id: 'hundred-checkins', label: '百次', sub: '打卡', color: 'ink', unlocked: true, unlockedAt: NOW },
          { id: 'thousand-km', label: '千里', sub: '步行', color: 'amber', unlocked: true, unlockedAt: NOW },
          { id: 'work-complete', label: '通关', sub: '作品', color: 'emerald', unlocked: false, unlockedAt: null },
          { id: 'eight-prefectures', label: '八县', sub: '巡游', color: 'sky', unlocked: false, unlockedAt: null },
          { id: 'sakura-season', label: '樱花', sub: '季', color: 'rose', unlocked: false, unlockedAt: null },
          { id: 'sync-master', label: '神还原', sub: '对比图', color: 'slate', unlocked: false, unlockedAt: null },
          { id: 'note-writer', label: '作家', sub: '随笔', color: 'stone', unlocked: false, unlockedAt: null },
        ]}
        nextAchievement={{ label: '200 次打卡', progress: 156, target: 200 }}
        totalUnlocked={3}
      />,
    )
    const slots = container.querySelectorAll('[data-achievement]')
    expect(slots.length).toBe(8)
  })

  it('marks locked achievements with data-locked', () => {
    const { container } = render(
      <AchievementWall
        achievements={[
          { id: 'first-checkin', label: '首次', sub: '打卡', color: 'seal-red', unlocked: false, unlockedAt: null },
        ]}
        nextAchievement={null}
        totalUnlocked={0}
      />,
    )
    expect(container.querySelector('[data-achievement]')?.getAttribute('data-locked')).toBe('true')
  })

  it('shows next achievement label when provided', () => {
    const { getByText } = render(
      <AchievementWall
        achievements={[]}
        nextAchievement={{ label: '200 次打卡', progress: 156, target: 200 }}
        totalUnlocked={0}
      />,
    )
    expect(getByText(/下一个成就：/)).toBeTruthy()
    expect(getByText(/200 次打卡/)).toBeTruthy()
  })
})
