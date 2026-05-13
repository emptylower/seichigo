import Image from 'next/image'
import { PaperCard } from '../primitives/PaperCard'
import { RedSeal } from '../primitives/RedSeal'
import { WashiTape } from '../primitives/WashiTape'
import { InkDivider } from '../primitives/InkDivider'
import { StitchedBorder } from '../primitives/StitchedBorder'
import { PageFoldCorner } from '../primitives/PageFoldCorner'
import type { JournalSnapshot } from '@/lib/journal/types'

function formatNumber(n: number): string {
  return n.toLocaleString('en-US')
}

function formatDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function JournalCover({ snapshot }: { snapshot: JournalSnapshot }) {
  const { user, stats, currentTrip } = snapshot
  return (
    <section className="relative mb-14">
      <WashiTape color="rose" className="-rotate-1 left-20 -top-2" />
      <WashiTape color="indigo" className="rotate-2 right-32 -top-2" />

      <PaperCard className="p-12">
        <div className="flex items-baseline justify-between mb-8">
          <div>
            <div className="text-xs tracking-[6px] text-journal-ink-muted mb-2">
              VOL. 01 · 第 {user.daysSinceJoined} 天
            </div>
            <h1 className="font-journal-serif font-black text-[44px] leading-none tracking-wide">
              {user.name} 的手帐
            </h1>
            <div className="font-journal-latin italic text-journal-ink-muted mt-3 text-lg">
              {user.name}&rsquo;s Pilgrimage Journal
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs tracking-[3px] text-journal-ink-muted">
              {user.journalNumber}
            </div>
          </div>
        </div>

        <InkDivider className="mb-10" />

        <div className="grid grid-cols-12 gap-10 items-center">
          <div className="col-span-3 relative">
            <div className="relative inline-block">
              {user.image ? (
                <Image
                  src={user.image}
                  alt={`${user.name} avatar`}
                  width={112}
                  height={112}
                  className="rounded-full ring-4 ring-journal-ink/85 ring-offset-4 ring-offset-journal-paper-card"
                />
              ) : (
                <div className="w-28 h-28 rounded-full bg-gradient-to-br from-rose-200 via-amber-200 to-stone-200 ring-4 ring-journal-ink/85 ring-offset-4 ring-offset-journal-paper-card" />
              )}
              <RedSeal className="absolute -bottom-2 -right-4 text-[10px]">
                巡礼者
              </RedSeal>
            </div>
            {user.bio ? (
              <p className="text-xs text-journal-ink-muted mt-3 leading-relaxed">
                「{user.bio}」
              </p>
            ) : null}
          </div>

          <div className="col-span-6 grid grid-cols-5 gap-2">
            <Stat value={formatNumber(stats.worksVisited)} label="部作品" />
            <Stat value={formatNumber(stats.pointsVisited)} label="取景地" />
            <Stat value={formatNumber(stats.totalCheckins)} label="次打卡" highlight />
            <Stat value={formatNumber(stats.totalKilometers)} label="公里" />
            <Stat value={formatNumber(stats.totalTrips)} label="次行程" />
          </div>

          <div className="col-span-3 relative">
            {currentTrip ? (
              <>
                <RedSeal className="absolute -top-3 -right-2 z-10 text-[10px]">
                  {currentTrip.status === 'in_progress' ? '进行中' : '准备中'}
                </RedSeal>
                <StitchedBorder className="p-5 bg-[#faf5e6] relative">
                  <div className="text-[10px] tracking-[3px] text-journal-ink-muted mb-2">
                    正在准备的行程
                  </div>
                  <div className="font-journal-serif text-lg font-bold leading-tight">
                    {currentTrip.title}
                  </div>
                  <div className="flex gap-3 mt-3 text-[11px] text-journal-ink-soft">
                    {currentTrip.durationDays ? <span>{currentTrip.durationDays} 天</span> : null}
                    {currentTrip.durationDays ? <span>·</span> : null}
                    <span>{currentTrip.pointCount} 个取景地</span>
                  </div>
                  {currentTrip.departureDate ? (
                    <div className="mt-3 text-[10px] text-journal-ink-muted">
                      出发日 {formatDate(currentTrip.departureDate)}
                    </div>
                  ) : null}
                  <PageFoldCorner />
                </StitchedBorder>
              </>
            ) : null}
          </div>
        </div>
      </PaperCard>
    </section>
  )
}

function Stat({
  value,
  label,
  highlight = false,
}: {
  value: string
  label: string
  highlight?: boolean
}) {
  return (
    <div className="text-center">
      <div
        className={[
          'font-journal-serif font-bold text-[40px] leading-none tracking-tight',
          highlight ? 'text-journal-seal' : 'text-journal-ink',
        ].join(' ')}
      >
        {value}
      </div>
      <div className="text-[11px] text-journal-ink-muted tracking-[3px] mt-1">
        {label}
      </div>
    </div>
  )
}
