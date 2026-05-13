import { PaperCard } from '../primitives/PaperCard'
import type { JournalSnapshot } from '@/lib/journal/types'

type Props = {
  workProgress: JournalSnapshot['workProgress']
}

export function WorkProgress({ workProgress }: Props) {
  const totalVisited = workProgress.reduce((a, w) => a + w.visitedPoints, 0)
  const totalPoints = workProgress.reduce((a, w) => a + w.totalPoints, 0)

  return (
    <PaperCard className="p-7 rounded-sm">
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <div className="font-journal-latin italic text-journal-ink-muted text-sm">Works</div>
          <h3 className="font-journal-serif text-xl font-bold">作品巡礼进度</h3>
        </div>
        <div className="text-[11px] text-journal-ink-muted tracking-wider">
          {workProgress.length} 部 · {totalVisited}/{totalPoints} 个点位
        </div>
      </div>

      {workProgress.length === 0 ? (
        <p className="text-[12px] text-journal-ink-muted py-4 text-center">
          还没开始巡礼任何作品。
        </p>
      ) : (
        <div className="space-y-3">
          {workProgress.map((w) => (
            <div key={w.workTitle}>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium">《{w.workTitle}》</span>
                <span className="text-journal-ink-muted">
                  {w.visitedPoints} / {w.totalPoints} ·{' '}
                  <span className={w.percent === 100 ? 'text-journal-seal' : ''}>{w.percent}%</span>
                </span>
              </div>
              <div className="h-2 bg-journal-ink/5 border border-journal-thread">
                <div
                  className={[
                    'h-2',
                    w.percent === 100 ? 'bg-journal-seal' : 'bg-journal-ink-soft',
                  ].join(' ')}
                  style={{ width: `${w.percent}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </PaperCard>
  )
}
