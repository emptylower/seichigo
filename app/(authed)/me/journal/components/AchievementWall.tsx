import { PaperCard } from '../primitives/PaperCard'
import { InkDivider } from '../primitives/InkDivider'
import type { JournalSnapshot } from '@/lib/journal/types'

type Props = {
  achievements: JournalSnapshot['achievements']
  nextAchievement: JournalSnapshot['nextAchievement']
  totalUnlocked: number
}

const COLOR_BG: Record<JournalSnapshot['achievements'][number]['color'], string> = {
  'seal-red': 'bg-journal-seal',
  ink: 'bg-journal-ink',
  amber: 'bg-amber-700',
  emerald: 'bg-emerald-800',
  sky: 'bg-sky-800',
  rose: 'bg-rose-700',
  slate: 'bg-slate-700',
  stone: 'bg-stone-700',
}

export function AchievementWall({ achievements, nextAchievement, totalUnlocked }: Props) {
  return (
    <PaperCard className="p-7 rounded-sm">
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <div className="font-journal-latin italic text-journal-ink-muted text-sm">
            Achievements
          </div>
          <h3 className="font-journal-serif text-xl font-bold">成就墙</h3>
        </div>
        <div className="text-[11px] text-journal-ink-muted tracking-wider">
          {totalUnlocked} / 8 枚
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-4">
        {achievements.map((a) => (
          <div
            key={a.id}
            data-achievement={a.id}
            data-locked={a.unlocked ? 'false' : 'true'}
            className="text-center"
            title={a.unlocked && a.unlockedAt ? `${a.label}${a.sub} · ${a.unlockedAt.toISOString().slice(0, 10)}` : `${a.label}${a.sub}（未解锁）`}
          >
            <div
              className={[
                'aspect-square w-12 h-12 rounded-full mx-auto grid place-items-center',
                'font-journal-serif font-bold text-[10px] text-journal-paper-card',
                a.unlocked ? COLOR_BG[a.color] : 'bg-stone-300 opacity-50',
              ].join(' ')}
            >
              {a.label}
            </div>
            <div className="text-[9px] text-journal-ink-muted mt-1.5 tracking-wider">{a.sub}</div>
          </div>
        ))}
      </div>

      <InkDivider className="mb-3" />

      {nextAchievement ? (
        <p className="text-[11px] text-journal-ink-soft leading-relaxed">
          下一个成就：
          <span className="text-journal-seal font-medium">{nextAchievement.label}</span>，还差{' '}
          {Math.max(nextAchievement.target - nextAchievement.progress, 0)} 次
        </p>
      ) : (
        <p className="text-[11px] text-journal-ink-muted">所有成就已解锁，巡礼老手。</p>
      )}
    </PaperCard>
  )
}
