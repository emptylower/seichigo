import type { AchievementColor } from './types'

export type AchievementInput = {
  totalCheckins: number
  totalKilometers: number
  worksCompleted: number
  prefectureCount: number
  springCheckin: boolean
  highSyncRateComposite: boolean
  notesPublished: number
}

export type AchievementDef = {
  id: string
  label: string
  sub: string
  color: AchievementColor
  predicate: (input: AchievementInput) => boolean
  progress?: {
    current: (input: AchievementInput) => number
    target: number
    nextLabel: string
  }
}

export const ACHIEVEMENT_DEFS: ReadonlyArray<AchievementDef> = [
  {
    id: 'first-checkin', label: '首次', sub: '打卡', color: 'seal-red',
    predicate: (s) => s.totalCheckins >= 1,
    progress: { current: (s) => s.totalCheckins, target: 1, nextLabel: '1 次打卡' },
  },
  {
    id: 'hundred-checkins', label: '百次', sub: '打卡', color: 'ink',
    predicate: (s) => s.totalCheckins >= 100,
    progress: { current: (s) => s.totalCheckins, target: 100, nextLabel: '100 次打卡' },
  },
  {
    id: 'thousand-km', label: '千里', sub: '步行', color: 'amber',
    predicate: (s) => s.totalKilometers >= 1000,
    progress: { current: (s) => Math.round(s.totalKilometers), target: 1000, nextLabel: '1,000 公里' },
  },
  {
    id: 'work-complete', label: '通关', sub: '作品', color: 'emerald',
    predicate: (s) => s.worksCompleted >= 1,
    progress: { current: (s) => s.worksCompleted, target: 1, nextLabel: '完成一部作品' },
  },
  {
    id: 'eight-prefectures', label: '八县', sub: '巡游', color: 'sky',
    predicate: (s) => s.prefectureCount >= 8,
    progress: { current: (s) => s.prefectureCount, target: 8, nextLabel: '8 个县市' },
  },
  { id: 'sakura-season', label: '樱花', sub: '季', color: 'rose', predicate: (s) => s.springCheckin },
  { id: 'sync-master', label: '神还原', sub: '对比图', color: 'slate', predicate: (s) => s.highSyncRateComposite },
  {
    id: 'note-writer', label: '作家', sub: '随笔', color: 'stone',
    predicate: (s) => s.notesPublished >= 10,
    progress: { current: (s) => s.notesPublished, target: 10, nextLabel: '10 篇随笔' },
  },
]

export function evaluateAchievements(input: AchievementInput, now: Date) {
  return ACHIEVEMENT_DEFS.map((def) => {
    const unlocked = def.predicate(input)
    return {
      id: def.id, label: def.label, sub: def.sub, color: def.color,
      unlocked,
      unlockedAt: unlocked ? now : null,
    }
  })
}

export function pickNextAchievement(
  input: AchievementInput,
  _now: Date,
): { label: string; progress: number; target: number } | null {
  // Tiered targets for open-ended count-style goals.
  // Only include a family when the user has already started it (current >= first tier),
  // so inactive families don't win over ones the user is actively progressing.
  const CHECKIN_TIERS = [1, 100, 200, 500, 1000]
  const KM_TIERS = [1000, 5000, 10000]
  const PREFECTURE_TIERS = [8, 16, 32, 47]
  const NOTES_TIERS = [10, 50, 100]
  const WORKS_TIERS = [1, 5, 10]

  function nextTier(value: number, tiers: number[]): number | null {
    for (const t of tiers) if (value < t) return t
    return null
  }

  const candidates: Array<{ label: string; progress: number; target: number; remaining: number }> = []

  // Checkins: always consider (first tier is 1, so any activity qualifies)
  const ct = nextTier(input.totalCheckins, CHECKIN_TIERS)
  if (ct !== null && input.totalCheckins >= CHECKIN_TIERS[0]) {
    candidates.push({ label: `${ct.toLocaleString('en-US')} 次打卡`, progress: input.totalCheckins, target: ct, remaining: ct - input.totalCheckins })
  }

  // Kilometers: only if user has started (>= 1000 first tier)
  const km = nextTier(Math.round(input.totalKilometers), KM_TIERS)
  if (km !== null && Math.round(input.totalKilometers) >= KM_TIERS[0]) {
    candidates.push({ label: `${km.toLocaleString('en-US')} 公里`, progress: Math.round(input.totalKilometers), target: km, remaining: km - Math.round(input.totalKilometers) })
  }

  // Prefectures: only if user has started (>= 8 first tier)
  const pf = nextTier(input.prefectureCount, PREFECTURE_TIERS)
  if (pf !== null && input.prefectureCount >= PREFECTURE_TIERS[0]) {
    candidates.push({ label: `${pf} 个县市`, progress: input.prefectureCount, target: pf, remaining: pf - input.prefectureCount })
  }

  // Notes: only if user has started (>= 10 first tier)
  const nt = nextTier(input.notesPublished, NOTES_TIERS)
  if (nt !== null && input.notesPublished >= NOTES_TIERS[0]) {
    candidates.push({ label: `${nt} 篇随笔`, progress: input.notesPublished, target: nt, remaining: nt - input.notesPublished })
  }

  // Works: only if user has started (>= 1 first tier)
  const wk = nextTier(input.worksCompleted, WORKS_TIERS)
  if (wk !== null && input.worksCompleted >= WORKS_TIERS[0]) {
    candidates.push({ label: wk === 1 ? '完成一部作品' : `完成 ${wk} 部作品`, progress: input.worksCompleted, target: wk, remaining: wk - input.worksCompleted })
  }

  candidates.sort((a, b) => a.remaining - b.remaining)
  const best = candidates[0]
  return best ? { label: best.label, progress: best.progress, target: best.target } : null
}
