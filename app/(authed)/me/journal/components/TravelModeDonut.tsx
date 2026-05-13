import { PaperCard } from '../primitives/PaperCard'
import type { JournalSnapshot } from '@/lib/journal/types'

const LABELS: Record<JournalSnapshot['travelModeBreakdown'][number]['mode'], string> = {
  train: '电车',
  bus: '巴士',
  car: '自驾',
  walk: '徒步',
}

const COLORS: Record<JournalSnapshot['travelModeBreakdown'][number]['mode'], string> = {
  train: 'bg-journal-indigo',
  bus: 'bg-emerald-700',
  car: 'bg-amber-700',
  walk: 'bg-journal-seal',
}

const STROKE: Record<JournalSnapshot['travelModeBreakdown'][number]['mode'], string> = {
  train: '#2d3e50',
  bus: '#1f6b4f',
  car: '#a16207',
  walk: '#a8392b',
}

export function TravelModeDonut({
  breakdown,
}: {
  breakdown: JournalSnapshot['travelModeBreakdown']
}) {
  const C = 238.76
  let offset = 0
  return (
    <PaperCard className="p-7 rounded-sm">
      <div className="mb-5">
        <div className="font-journal-latin italic text-journal-ink-muted text-sm">By</div>
        <h3 className="font-journal-serif text-xl font-bold">出行方式分布</h3>
      </div>

      <div className="relative h-[140px] flex items-center justify-center mb-4">
        <svg viewBox="0 0 100 100" className="w-[140px] h-[140px] -rotate-90">
          {breakdown.map((m) => {
            const segment = (m.percent / 100) * C
            const dash = `${segment} ${C - segment}`
            const el = (
              <circle
                key={m.mode}
                cx={50}
                cy={50}
                r={38}
                fill="none"
                stroke={STROKE[m.mode]}
                strokeWidth={14}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
              />
            )
            offset += segment
            return el
          })}
        </svg>
        <div className="absolute text-center">
          <div className="font-journal-serif font-bold text-2xl leading-none">
            {breakdown[0]?.percent ?? 0}
            <span className="text-xs text-journal-ink-muted">%</span>
          </div>
          <div className="text-[9px] text-journal-ink-muted tracking-wider">
            {LABELS[breakdown[0]?.mode ?? 'walk']}
          </div>
        </div>
      </div>

      <div className="space-y-1.5 text-[11px]">
        {breakdown.map((m) => (
          <div key={m.mode} className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-sm ${COLORS[m.mode]}`} />
            <span className="flex-1">{LABELS[m.mode]}</span>
            <span className="text-journal-ink-muted">{m.percent}%</span>
          </div>
        ))}
      </div>
    </PaperCard>
  )
}
