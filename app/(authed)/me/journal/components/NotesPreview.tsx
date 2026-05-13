import { PaperCard } from '../primitives/PaperCard'
import { InkDivider } from '../primitives/InkDivider'
import { StitchedBorder } from '../primitives/StitchedBorder'
import type { JournalSnapshot } from '@/lib/journal/types'

type Props = {
  recentNotes: JournalSnapshot['recentNotes']
}

export function NotesPreview({ recentNotes }: Props) {
  const hasNotes = recentNotes.length > 0
  return (
    <PaperCard className="p-7 rounded-sm">
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <div className="font-journal-latin italic text-journal-ink-muted text-sm">
            Notes & Diaries
          </div>
          <h3 className="font-journal-serif text-xl font-bold">我的随笔</h3>
        </div>
        <div className="text-[11px] text-journal-ink-muted tracking-wider">
          已写 {recentNotes.length} 篇
        </div>
      </div>

      {hasNotes ? (
        <div className="space-y-5">
          {recentNotes.map((n) => (
            <article key={n.id} className="border-l-2 border-journal-seal/60 pl-4">
              <div className="flex items-center gap-2 text-[10px] text-journal-ink-muted tracking-wider mb-1.5">
                <span>{formatNoteDate(n.publishedAt)}</span>
                {n.location ? (
                  <>
                    <span>·</span>
                    <span>{n.location}</span>
                  </>
                ) : null}
              </div>
              <h4 className="font-journal-serif text-lg font-bold mb-2">{n.title}</h4>
              <p className="text-[12px] text-journal-ink-soft leading-relaxed line-clamp-3">
                {n.bodyPreview}
              </p>
            </article>
          ))}
        </div>
      ) : (
        <div className="py-6 text-center">
          <p className="text-[12px] text-journal-ink-muted leading-relaxed">
            还没写过随笔。
            <br />
            走完一段路、看完一篇攻略，
            <br />
            都可以在这里留下一些字句。
          </p>
        </div>
      )}

      <InkDivider className="my-4" />

      <StitchedBorder className="py-3 w-full text-center hover:bg-journal-paper/30 transition cursor-not-allowed opacity-60">
        <span className="font-journal-hand text-base text-journal-ink-soft">
          ＋ 写一篇新随笔（即将开放）
        </span>
      </StitchedBorder>
    </PaperCard>
  )
}

function formatNoteDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
