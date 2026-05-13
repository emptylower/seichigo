import { PaperCard } from '../primitives/PaperCard'
import { InkDivider } from '../primitives/InkDivider'
import { JapanMapSvg } from './JapanMapSvg'
import type { JournalSnapshot } from '@/lib/journal/types'

type Props = {
  pointsVisited: number
  prefectures: JournalSnapshot['prefectures']
  pins: JournalSnapshot['pinsForMap']
}

function pinPosition(lat: number, lng: number): { left: string; top: string } {
  const x = ((lng - 122) / (146 - 122)) * 100
  const y = (1 - (lat - 24) / (46 - 24)) * 100
  return { left: `${Math.max(0, Math.min(100, x))}%`, top: `${Math.max(0, Math.min(100, y))}%` }
}

export function PilgrimageMap({ pointsVisited, prefectures, pins }: Props) {
  return (
    <PaperCard className="p-7 rounded-sm">
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <div className="font-journal-latin italic text-journal-ink-muted text-sm">
            My Pilgrimage Map
          </div>
          <h3 className="font-journal-serif text-xl font-bold">我走过的地方</h3>
        </div>
        <div className="text-[11px] text-journal-ink-muted tracking-wider">
          {pointsVisited} 取景地 · 跨 {prefectures.length} 个县市
        </div>
      </div>

      <div className="relative h-[280px]">
        <JapanMapSvg className="w-full h-full" />
        {pins.map((pin, i) => {
          const pos = pinPosition(pin.lat, pin.lng)
          return (
            <span
              key={i}
              data-pin
              data-recent={pin.isMostRecent ? 'true' : 'false'}
              className={[
                'absolute w-2 h-2 rounded-full bg-journal-seal',
                'shadow-[0_0_0_2px_rgba(253,250,243,0.8),0_1px_3px_rgba(0,0,0,0.3)]',
                pin.isMostRecent
                  ? "before:absolute before:inset-[-6px] before:rounded-full before:border-2 before:border-journal-seal before:animate-ping"
                  : '',
              ].join(' ')}
              style={pos}
              aria-hidden="true"
            />
          )
        })}
      </div>

      <InkDivider className="my-4" />

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]">
        {prefectures.map((p, i) => (
          <span
            key={p.nameZh}
            className={i === 0 ? 'text-journal-ink font-medium' : 'text-journal-ink-soft'}
          >
            {p.nameZh}{' '}
            <span className={i === 0 ? 'text-journal-seal' : 'text-journal-ink-muted'}>
              {p.pointCount}
            </span>
          </span>
        ))}
      </div>
    </PaperCard>
  )
}
