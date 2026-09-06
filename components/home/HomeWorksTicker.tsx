'use client'

import { usePrefersReducedMotion } from './usePrefersReducedMotion'

/**
 * 作品名滚动条：一条 12px 的灰字横条，CSS `translateX` 40 秒一圈，hover 暂停。
 * 轨道渲染两份（第二份 `aria-hidden`）让平移 -50% 时首尾无缝；
 * `prefers-reduced-motion` 下只渲染一份并静态换行排列。
 */
export default function HomeWorksTicker({ names, label }: { names: string[]; label: string }) {
  const reduced = usePrefersReducedMotion()
  if (!names.length) return null

  const track = (duplicate: boolean) => (
    <span
      data-ticker-track
      data-animated={reduced ? 'false' : 'true'}
      aria-hidden={duplicate ? 'true' : undefined}
      className={
        reduced
          ? 'flex flex-wrap justify-center gap-x-3 gap-y-1'
          : 'seichigo-works-track flex shrink-0 gap-3 whitespace-nowrap pr-3'
      }
    >
      {names.map((name, index) => (
        <span key={`${name}-${index}`} className="text-gray-400">
          {name}
        </span>
      ))}
    </span>
  )

  if (reduced) {
    return (
      <div aria-label={label} className="text-xs leading-5">
        {track(false)}
      </div>
    )
  }

  return (
    <div aria-label={label} className="seichigo-works group relative overflow-hidden text-xs leading-5">
      <style>{`
        @keyframes seichigo-works-scroll { from { transform: translateX(0) } to { transform: translateX(-50%) } }
        .seichigo-works-track { animation: seichigo-works-scroll 40s linear infinite; }
        .seichigo-works:hover .seichigo-works-track { animation-play-state: paused; }
        @media (prefers-reduced-motion: reduce) { .seichigo-works-track { animation: none; } }
      `}</style>
      <div className="flex w-max">
        {track(false)}
        {track(true)}
      </div>
    </div>
  )
}
