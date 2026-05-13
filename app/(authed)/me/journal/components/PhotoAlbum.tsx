import Image from 'next/image'
import { PaperCard } from '../primitives/PaperCard'
import { WashiTape } from '../primitives/WashiTape'
import type { JournalSnapshot } from '@/lib/journal/types'

const COLORS: Array<'rose' | 'amber' | 'emerald' | 'violet'> = ['rose', 'amber', 'emerald', 'violet']

export function PhotoAlbum({ photos }: { photos: JournalSnapshot['recentPhotos'] }) {
  return (
    <PaperCard className="p-7 rounded-sm">
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <div className="font-journal-latin italic text-journal-ink-muted text-sm">My Album</div>
          <h3 className="font-journal-serif text-xl font-bold">我的相册</h3>
        </div>
        <a href="/me/journal/album" className="text-[11px] text-journal-seal tracking-wider hover:underline">
          翻开全部照片 →
        </a>
      </div>

      {photos.length === 0 ? (
        <p className="text-[12px] text-journal-ink-muted py-4 text-center">
          相册还是空的。打过卡的地方，留下的照片会在这里。
        </p>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          {photos.map((p, i) => (
            <figure key={p.id} className="relative">
              <div className="relative aspect-[4/5] overflow-hidden shadow-md bg-journal-paper-warm">
                <Image
                  src={p.photoUrl}
                  alt={`${p.placeName}`}
                  fill
                  sizes="(min-width: 1024px) 200px, 50vw"
                  className="object-cover"
                  unoptimized
                />
              </div>
              <WashiTape color={COLORS[i % COLORS.length]} className="top-2 left-2 right-2 !w-auto" />
              <figcaption className="mt-2 text-[10px]">
                <div className="text-journal-ink-muted tracking-wider">
                  {formatPhotoDate(p.takenAt)} · {p.placeName}
                </div>
                {p.workTitle ? (
                  <div className="text-journal-ink font-medium">《{p.workTitle}》</div>
                ) : null}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </PaperCard>
  )
}

function formatPhotoDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
