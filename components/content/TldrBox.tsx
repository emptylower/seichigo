import type { PostFrontmatter } from '@/lib/mdx/types'

type Props = {
  tldr?: PostFrontmatter['tldr']
}

export default function TldrBox({ tldr }: Props) {
  if (!tldr) return null

  const duration = typeof tldr.duration === 'string' ? tldr.duration.trim() : ''
  const transport = typeof tldr.transport === 'string' ? tldr.transport.trim() : ''
  const cost = typeof tldr.estimatedCost === 'string' ? tldr.estimatedCost.trim() : ''
  const start = typeof tldr.startPoint === 'string' ? tldr.startPoint.trim() : ''
  const end = typeof tldr.endPoint === 'string' ? tldr.endPoint.trim() : ''
  const totalSpots = typeof tldr.totalSpots === 'number' && Number.isFinite(tldr.totalSpots) ? tldr.totalSpots : null

  return (
    <div className="not-prose my-6 rounded-xl border border-pink-100 bg-pink-50/60 p-4 shadow-sm">
      <div className="text-sm font-semibold text-gray-900">TL;DR</div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm text-gray-700">
        {duration ? <span>⏱ {duration}</span> : null}
        {typeof totalSpots === 'number' ? <span>📍 {totalSpots} 个点位</span> : null}
        {transport ? <span>🚃 {transport}</span> : null}
        {cost ? <span>💴 {cost}</span> : null}
      </div>
      {start || end ? <div className="mt-2 text-sm text-gray-700">🚩 {start || '起点'} → {end || '终点'}</div> : null}
    </div>
  )
}
