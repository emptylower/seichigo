import { describe, expect, it } from 'vitest'
import {
  ACHIEVEMENT_DEFS,
  evaluateAchievements,
  pickNextAchievement,
  type AchievementInput,
} from '@/lib/journal/achievements'

const base: AchievementInput = {
  totalCheckins: 0,
  totalKilometers: 0,
  worksCompleted: 0,
  prefectureCount: 0,
  springCheckin: false,
  highSyncRateComposite: false,
  notesPublished: 0,
}

describe('achievements', () => {
  it('exposes exactly 8 stable definitions in fixed order', () => {
    expect(ACHIEVEMENT_DEFS.map((d) => d.id)).toEqual([
      'first-checkin',
      'hundred-checkins',
      'thousand-km',
      'work-complete',
      'eight-prefectures',
      'sakura-season',
      'sync-master',
      'note-writer',
    ])
  })

  it('locks all achievements for a fresh user', () => {
    const result = evaluateAchievements(base, new Date('2025-03-20'))
    for (const a of result) expect(a.unlocked).toBe(false)
  })

  it('unlocks first-checkin when totalCheckins >= 1', () => {
    const result = evaluateAchievements({ ...base, totalCheckins: 1 }, new Date('2025-03-20'))
    expect(result.find((a) => a.id === 'first-checkin')?.unlocked).toBe(true)
  })

  it('unlocks hundred-checkins at exactly 100 and not at 99', () => {
    const r99 = evaluateAchievements({ ...base, totalCheckins: 99 }, new Date('2025-03-20'))
    const r100 = evaluateAchievements({ ...base, totalCheckins: 100 }, new Date('2025-03-20'))
    expect(r99.find((a) => a.id === 'hundred-checkins')?.unlocked).toBe(false)
    expect(r100.find((a) => a.id === 'hundred-checkins')?.unlocked).toBe(true)
  })

  it('picks next achievement closest to unlock (smallest remaining ratio)', () => {
    const next = pickNextAchievement(
      { ...base, totalCheckins: 156 },
      new Date('2025-03-20'),
    )
    expect(next).toEqual({ label: '200 次打卡', progress: 156, target: 200 })
  })

  it('returns null next achievement when everything is unlocked', () => {
    const next = pickNextAchievement(
      {
        totalCheckins: 1000,
        totalKilometers: 10000,
        worksCompleted: 10,
        prefectureCount: 47,
        springCheckin: true,
        highSyncRateComposite: true,
        notesPublished: 100,
      },
      new Date('2025-03-20'),
    )
    expect(next).toBeNull()
  })
})
