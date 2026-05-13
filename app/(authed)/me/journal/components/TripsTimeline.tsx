import { PaperCard } from '../primitives/PaperCard'
import type { JournalSnapshot } from '@/lib/journal/types'

type Props = {
  totalCheckins: number
  totalTrips: number
  trips: JournalSnapshot['tripsForTimeline']
}

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

const COLORS: Record<JournalSnapshot['tripsForTimeline'][number]['status'], string> = {
  completed: 'bg-journal-ink/80 border border-journal-ink/0',
  in_progress: 'bg-journal-seal/80 shadow border border-journal-seal/0',
  planned: 'bg-transparent border border-dashed border-journal-seal',
}

export function TripsTimeline({ totalCheckins, totalTrips, trips }: Props) {
  return (
    <PaperCard className="p-7 rounded-sm">
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <div className="font-journal-latin italic text-journal-ink-muted text-sm">
            My Trips
          </div>
          <h3 className="font-journal-serif text-xl font-bold">我的旅程表</h3>
        </div>
        <div className="flex gap-5 text-[11px] text-journal-ink-muted tracking-wider">
          <span>
            <span className="text-journal-seal font-journal-serif font-bold text-base">
              {totalCheckins}
            </span>{' '}
            次打卡
          </span>
          <span>
            <span className="text-journal-ink font-journal-serif font-bold text-base">
              {totalTrips}
            </span>{' '}
            次行程
          </span>
        </div>
      </div>

      <div className="relative h-[120px]">
        <div className="absolute inset-x-0 top-[60px] flex justify-between text-[9px] text-journal-ink-muted tracking-wider">
          {MONTHS.map((m) => (
            <span key={m}>{m}月</span>
          ))}
        </div>
        <div className="absolute inset-x-0 top-[55px] h-px bg-journal-thread" />

        {trips.map((t, idx) => {
          const left = ((t.monthStart - 1) / 12) * 100
          const widthMonths = Math.max(t.monthEnd - t.monthStart, 0) + 1
          const width = Math.min((widthMonths / 12) * 100, 100 - left)
          const top = idx % 2 === 0 ? '10px' : '25px'
          const colorClass = COLORS[t.status]
          const label = t.title || [t.workTitle, t.location].filter(Boolean).join(' · ')
          return (
            <div key={t.id}>
              <div
                data-ribbon
                data-status={t.status}
                className={['absolute h-2 rounded-sm', colorClass].join(' ')}
                style={{ left: `${left}%`, width: `${width}%`, top }}
                title={t.title}
              />
              <div
                className="absolute text-[9px] text-journal-ink-muted whitespace-nowrap"
                style={{ left: `${left}%`, top: idx % 2 === 0 ? '-4px' : '44px' }}
              >
                {label}
              </div>
            </div>
          )
        })}

        <div className="absolute top-[100px] left-[2%] text-[9px] text-journal-ink-muted tracking-wider">
          每个 ● 是一次打卡
        </div>
      </div>
    </PaperCard>
  )
}
